import { Router } from 'express'
import crypto from 'node:crypto'
import { db, HttpError } from '../lib/db.js'
import { requireTenant, route } from '../lib/auth.js'
import {
  OLX_AUTH_URL,
  OLX_TOKEN_URL,
  catalogo,
  conexaoDaLoja,
  dadosDaConta,
  enviarParaOlx,
  hashDoAnuncio,
  idDoAnuncio,
  montarAnuncio,
  olxConfig,
  situacaoDoEnvio,
  soDigitos,
  sugerirCatalogo,
} from '../lib/olx.js'

/**
 * Rotas da OLX. Mesmo desenho do Google Agenda (routes/google.js): o lojista
 * autoriza com um clique, a chave fica so no servidor e o painel nunca a ve.
 *
 * Nenhuma rota daqui e chamada se a loja nao conectou a OLX, e sem as variaveis
 * OLX_CLIENT_ID / OLX_CLIENT_SECRET o servidor responde 501 -- nada quebra.
 */

const router = Router()

function escapaHtml(texto) {
  return String(texto ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  )
}

function paraScript(valor) {
  return JSON.stringify(String(valor ?? '')).replace(/</g, '\\u003c')
}

function segredo() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || 'wissen-dev-secret'
}

function signState(tenantId) {
  const payload = Buffer.from(JSON.stringify({ tenant_id: tenantId, ts: Date.now(), p: 'olx' })).toString('base64url')
  const signature = crypto.createHmac('sha256', segredo()).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

function readState(state) {
  const [payload, signature] = String(state || '').split('.')
  if (!payload || !signature) throw new HttpError(400, 'Parâmetro state ausente ou malformado.')
  const expected = crypto.createHmac('sha256', segredo()).update(payload).digest('base64url')
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new HttpError(400, 'Assinatura do state inválida.')
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString())
  if (data.p !== 'olx') throw new HttpError(400, 'Autorização inválida.')
  if (Date.now() - data.ts > 15 * 60 * 1000) throw new HttpError(400, 'Autorização expirada. Tente novamente.')
  return data
}

/** Ultimos 10-11 digitos, sem o 55 do Brasil -- para comparar telefones. */
const numeroLocal = (valor) => soDigitos(valor).replace(/^55(?=\d{10,11}$)/, '')

/** Numeros da Julia nesta loja. O anuncio da OLX nunca pode usar um deles. */
async function numerosDaJulia(tenantId, settings) {
  const canal = await db.selectOne('tenant_channels', `tenant_id=eq.${tenantId}&select=whatsapp_number`)
  return [canal?.whatsapp_number, settings?.bot_phone].map(numeroLocal).filter((n) => n.length >= 10)
}

async function exigeConexao(tenantId) {
  const conexao = await conexaoDaLoja(tenantId)
  if (!conexao) throw new HttpError(409, 'A loja ainda não conectou a OLX.', 'Conecte em Integrações.')
  return conexao
}

async function gravaAnuncio(linha) {
  await db.upsert('olx_anuncios', [{ ...linha, atualizado_em: new Date().toISOString() }], 'car_id')
}

const NA_OLX = ['enviado', 'em_analise', 'publicado']

/**
 * Deixa a OLX igual ao painel para um carro:
 * - disponivel e liberado para a OLX -> publica ou atualiza;
 * - sinal recebido, vendido, tirado da OLX ou excluido -> tira do ar.
 * `forcar` publica mesmo com "publicar tudo automaticamente" desligado.
 */
async function sincronizarCarro({ tenantId, conexao, store, carId, forcar = false }) {
  const [car, registro] = await Promise.all([
    db.selectOne('cars', `id=eq.${carId}&tenant_id=eq.${tenantId}&select=*`),
    db.selectOne('olx_anuncios', `car_id=eq.${carId}&tenant_id=eq.${tenantId}&select=*`),
  ])

  const jaNaOlx = Boolean(registro && NA_OLX.includes(registro.situacao))
  const deveEstar =
    Boolean(car) && car.status === 'ativo' && car.olx_publicar !== false && (conexao.publicar_tudo || forcar || jaNaOlx)

  if (!deveEstar) {
    if (!registro) return { situacao: 'fora' }
    // Nunca chegou a OLX: so marca. Ja foi enviado alguma vez: pede para tirar.
    if (!registro.token_importacao || ['removido', 'removendo'].includes(registro.situacao)) {
      if (registro.situacao !== 'removido' && registro.situacao !== 'removendo') {
        await gravaAnuncio({ car_id: carId, tenant_id: tenantId, olx_id: registro.olx_id, situacao: 'removido', mensagem: null })
      }
      return { situacao: registro.situacao === 'removendo' ? 'removendo' : 'removido' }
    }
    const envio = await enviarParaOlx(conexao.access_token, [{ id: registro.olx_id, operation: 'delete' }])
    await gravaAnuncio({
      car_id: carId,
      tenant_id: tenantId,
      olx_id: registro.olx_id,
      situacao: envio.ok ? 'removendo' : 'erro',
      operacao: 'delete',
      mensagem: envio.ok ? null : envio.mensagem,
      ...(envio.token ? { token_importacao: envio.token } : {}),
      conteudo_hash: null,
    })
    return { situacao: envio.ok ? 'removendo' : 'erro', mensagem: envio.mensagem }
  }

  const fotos = await db.select('car_photos', `car_id=eq.${carId}&select=url,ordem,is_cover&order=is_cover.desc,ordem.asc`)
  const { anuncio, faltando } = montarAnuncio({ car, fotos, store, conexao })
  const olxId = registro?.olx_id ?? idDoAnuncio(carId)

  if (faltando) {
    const mensagem = `Falta preencher: ${faltando.join(', ')}.${jaNaOlx ? ' O anúncio que já está na OLX continua como estava.' : ''}`
    await gravaAnuncio({ car_id: carId, tenant_id: tenantId, olx_id: olxId, situacao: 'incompleto', mensagem })
    return { situacao: 'incompleto', mensagem, faltando }
  }

  anuncio.id = olxId
  const hash = hashDoAnuncio(anuncio)
  // Nada mudou desde o ultimo envio: nao manda de novo (evita nova moderacao na OLX).
  if (jaNaOlx && registro.conteudo_hash === hash) return { situacao: registro.situacao }

  const envio = await enviarParaOlx(conexao.access_token, [anuncio])
  await gravaAnuncio({
    car_id: carId,
    tenant_id: tenantId,
    olx_id: olxId,
    situacao: envio.ok ? 'enviado' : 'erro',
    operacao: 'insert',
    mensagem: envio.ok ? null : envio.mensagem,
    ...(envio.token ? { token_importacao: envio.token } : {}),
    conteudo_hash: envio.ok ? hash : null,
  })
  return { situacao: envio.ok ? 'enviado' : 'erro', mensagem: envio.mensagem }
}

// --- Conectar e desconectar ----------------------------------------------------

router.get(
  '/auth-url',
  route(async (req, res) => {
    const { tenant } = await requireTenant(req)
    const { clientId, redirectUri } = olxConfig()
    const url = new URL(OLX_AUTH_URL)
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', 'autoupload basic_user_info')
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('state', signState(tenant.id))
    res.json({ url: url.toString() })
  }),
)

router.get('/callback', async (req, res) => {
  const appUrl = process.env.APP_URL || 'http://localhost:5173'

  const done = (ok, error) =>
    res
      .status(ok ? 200 : 400)
      .type('html')
      .send(`<!doctype html><meta charset="utf-8"><title>Wissen Cars</title>
<body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;color:#0F172A">
<div style="text-align:center">
  <h1 style="font-size:1.1rem">${ok ? 'OLX conectada!' : 'Não foi possível conectar a OLX'}</h1>
  <p style="color:#64748B;font-size:.9rem">${ok ? 'Pode fechar esta janela.' : escapaHtml(error)}</p>
</div>
<script>
  try {
    window.opener && window.opener.postMessage(
      { type: 'wissen:olx', ok: ${ok ? 'true' : 'false'}, error: ${paraScript(error)} },
      ${paraScript(appUrl)}
    );
  } catch (e) {}
  setTimeout(function () { window.close() }, ${ok ? 1200 : 4000});
</script>
</body>`)

  try {
    const { code, state, error: oauthError } = req.query
    if (oauthError) throw new HttpError(400, `Autorização negada (${oauthError}).`)
    if (!code) throw new HttpError(400, 'Código de autorização ausente.')

    const { tenant_id: tenantId } = readState(state)
    const { clientId, clientSecret, redirectUri } = olxConfig()

    const tokenRes = await fetch(OLX_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(code),
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })
    const tokens = await tokenRes.json().catch(() => ({}))
    if (!tokenRes.ok || !tokens.access_token) {
      throw new HttpError(400, tokens.error_description || 'A OLX não devolveu a autorização. Tente de novo.')
    }

    const conta = await dadosDaConta(tokens.access_token)
    const anterior = await conexaoDaLoja(tenantId)

    // Telefone sugerido: o da loja, desde que nao seja o WhatsApp da Julia.
    let telefone = anterior?.telefone_anuncio ?? null
    if (!telefone) {
      const [loja, settings] = await Promise.all([
        db.selectOne('stores', `tenant_id=eq.${tenantId}&select=phone`),
        db.selectOne('tenant_settings', `tenant_id=eq.${tenantId}&select=bot_phone`),
      ])
      const daJulia = await numerosDaJulia(tenantId, settings)
      const candidato = numeroLocal(loja?.phone)
      if (candidato.length >= 10 && !daJulia.includes(candidato)) telefone = candidato
    }

    await db.upsert(
      'olx_conexoes',
      [
        {
          tenant_id: tenantId,
          access_token: tokens.access_token,
          conta_nome: conta.nome,
          conta_email: conta.email,
          telefone_anuncio: telefone,
          publicar_tudo: anterior?.publicar_tudo ?? true,
          atualizado_em: new Date().toISOString(),
        },
      ],
      'tenant_id',
    )
    done(true)
  } catch (error) {
    done(false, error.message)
  }
})

/**
 * Desconecta a loja. Os anuncios que ja estao na OLX ficam la (a loja tira pela
 * propria OLX, se quiser) -- o painel so para de mexer neles.
 */
router.post(
  '/desconectar',
  route(async (req, res) => {
    const { tenant } = await requireTenant(req)
    await db.delete('olx_conexoes', `tenant_id=eq.${tenant.id}`)
    res.json({ ok: true })
  }),
)

router.post(
  '/configurar',
  route(async (req, res) => {
    const { tenant, settings } = await requireTenant(req)
    await exigeConexao(tenant.id)
    const patch = { atualizado_em: new Date().toISOString() }

    if (req.body.telefone_anuncio !== undefined) {
      const telefone = numeroLocal(req.body.telefone_anuncio)
      if (telefone.length < 10 || telefone.length > 11) {
        throw new HttpError(400, 'Informe o telefone com DDD, só números. Ex.: 11987654321.')
      }
      const daJulia = await numerosDaJulia(tenant.id, settings)
      if (daJulia.includes(telefone)) {
        throw new HttpError(400, 'Esse é o WhatsApp da Júlia. Use outro número da loja para o anúncio da OLX.')
      }
      patch.telefone_anuncio = telefone
    }
    if (typeof req.body.publicar_tudo === 'boolean') patch.publicar_tudo = req.body.publicar_tudo

    const [linha] = await db.update('olx_conexoes', `tenant_id=eq.${tenant.id}`, patch)
    res.json({ ok: true, telefone_anuncio: linha?.telefone_anuncio ?? null, publicar_tudo: linha?.publicar_tudo ?? true })
  }),
)

// --- Catalogo -----------------------------------------------------------------

router.post(
  '/sugerir',
  route(async (req, res) => {
    const { tenant } = await requireTenant(req)
    const conexao = await exigeConexao(tenant.id)
    const { brand, model, version, engine, transmission } = req.body
    res.json(await sugerirCatalogo(conexao.access_token, { brand, model, version, engine, transmission }))
  }),
)

router.get(
  '/catalogo',
  route(async (req, res) => {
    const { tenant } = await requireTenant(req)
    const conexao = await exigeConexao(tenant.id)
    const { marca, modelo } = req.query
    res.json({ itens: await catalogo(conexao.access_token, marca, marca ? modelo : undefined) })
  }),
)

// --- Publicar, tirar e acompanhar ----------------------------------------------

/** Chamado pelo painel depois de salvar, vender, dar sinal ou excluir um carro. */
router.post(
  '/sincronizar',
  route(async (req, res) => {
    const { tenant, store } = await requireTenant(req)
    const conexao = await conexaoDaLoja(tenant.id)
    if (!conexao) return res.json({ situacao: 'sem_conexao' })
    const carId = String(req.body.car_id || '')
    if (!/^[0-9a-f-]{36}$/i.test(carId)) throw new HttpError(400, 'Carro inválido.')
    res.json(await sincronizarCarro({ tenantId: tenant.id, conexao, store, carId, forcar: req.body.forcar === true }))
  }),
)

/** Publica de uma vez todos os carros disponiveis liberados para a OLX. */
router.post(
  '/publicar-tudo',
  route(async (req, res) => {
    const { tenant, store } = await requireTenant(req)
    const conexao = await exigeConexao(tenant.id)

    const [carros, registros, fotos] = await Promise.all([
      db.select('cars', `tenant_id=eq.${tenant.id}&status=eq.ativo&olx_publicar=is.true&select=*`),
      db.select('olx_anuncios', `tenant_id=eq.${tenant.id}&select=*`),
      db.select('car_photos', `tenant_id=eq.${tenant.id}&select=car_id,url,ordem,is_cover&order=is_cover.desc,ordem.asc`),
    ])
    const porCarro = new Map(registros.map((r) => [r.car_id, r]))

    const prontos = []
    let incompletos = 0
    let iguais = 0
    for (const car of carros) {
      const registro = porCarro.get(car.id)
      const olxId = registro?.olx_id ?? idDoAnuncio(car.id)
      const { anuncio, faltando } = montarAnuncio({ car, fotos: fotos.filter((f) => f.car_id === car.id), store, conexao })
      if (faltando) {
        incompletos++
        await gravaAnuncio({
          car_id: car.id,
          tenant_id: tenant.id,
          olx_id: olxId,
          situacao: 'incompleto',
          mensagem: `Falta preencher: ${faltando.join(', ')}.`,
        })
        continue
      }
      anuncio.id = olxId
      const hash = hashDoAnuncio(anuncio)
      if (registro && NA_OLX.includes(registro.situacao) && registro.conteudo_hash === hash) {
        iguais++
        continue
      }
      prontos.push({ car, anuncio, hash })
    }

    let enviados = 0
    let comErro = 0
    let aviso = null
    for (let i = 0; i < prontos.length; i += 50) {
      const lote = prontos.slice(i, i + 50)
      const envio = await enviarParaOlx(conexao.access_token, lote.map((p) => p.anuncio))
      if (!envio.ok) aviso = envio.mensagem
      for (const p of lote) {
        await gravaAnuncio({
          car_id: p.car.id,
          tenant_id: tenant.id,
          olx_id: p.anuncio.id,
          situacao: envio.ok ? 'enviado' : 'erro',
          operacao: 'insert',
          mensagem: envio.ok ? null : envio.mensagem,
          ...(envio.token ? { token_importacao: envio.token } : {}),
          conteudo_hash: envio.ok ? p.hash : null,
        })
      }
      if (envio.ok) enviados += lote.length
      else comErro += lote.length
    }

    res.json({ enviados, incompletos, iguais, comErro, aviso })
  }),
)

/** Pergunta a OLX como estao os envios ainda em andamento e atualiza o painel. */
router.post(
  '/atualizar',
  route(async (req, res) => {
    const { tenant } = await requireTenant(req)
    const conexao = await conexaoDaLoja(tenant.id)
    if (!conexao) return res.json({ atualizados: 0 })

    const pendentes = await db.select(
      'olx_anuncios',
      `tenant_id=eq.${tenant.id}&situacao=in.(enviado,em_analise,removendo)&token_importacao=not.is.null&select=*`,
    )
    const tokens = [...new Set(pendentes.map((p) => p.token_importacao))].slice(0, 20)
    let atualizados = 0

    for (const token of tokens) {
      let situacoes
      try {
        situacoes = await situacaoDoEnvio(conexao.access_token, token)
      } catch {
        continue
      }
      for (const linha of pendentes.filter((p) => p.token_importacao === token)) {
        const info = situacoes[linha.olx_id]
        if (!info) continue
        const removendo = linha.situacao === 'removendo' || linha.operacao === 'delete'
        const situacao = removendo ? (info.situacao === 'publicado' ? 'removido' : info.situacao === 'em_analise' ? 'removendo' : info.situacao) : info.situacao
        if (situacao === linha.situacao && !info.url && !info.mensagem) continue
        await gravaAnuncio({
          car_id: linha.car_id,
          tenant_id: tenant.id,
          olx_id: linha.olx_id,
          situacao,
          mensagem: info.mensagem,
          ...(info.list_id ? { list_id: info.list_id } : {}),
          ...(info.url ? { url: info.url } : {}),
        })
        atualizados++
      }
    }
    res.json({ atualizados })
  }),
)

export default router
