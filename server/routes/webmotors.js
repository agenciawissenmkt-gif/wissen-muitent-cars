import { Router } from 'express'
import { db, HttpError } from '../lib/db.js'
import { requireTenant, route } from '../lib/auth.js'
import {
  alterarCarro,
  autenticar,
  baixarFoto,
  cifra,
  conexaoDaLoja,
  excluirCarro,
  excluirFoto,
  hashDoAnuncio,
  incluirCarro,
  incluirFoto,
  marcas,
  modalidades,
  modelos,
  montarAnuncio,
  sugerirCatalogo,
  versoes,
  webmotorsConfig,
  webmotorsConfigurada,
} from '../lib/webmotors.js'

/**
 * Rotas da Webmotors. Mesmo desenho da OLX (routes/olx.js): a loja conecta uma
 * vez em Integracoes, o login fica so no servidor e o painel nunca o ve.
 *
 * Nenhuma rota daqui fala com a Webmotors se a loja nao conectou. Sem as
 * variaveis WEBMOTORS_RELAY_URL / WEBMOTORS_RELAY_SECRET o servidor responde
 * 501 -- nada quebra.
 */

const router = Router()

/** Tempo maximo de uma sincronizacao (a funcao da Vercel tem 60 s). */
const ORCAMENTO_MS = 40_000

async function exigeConexao(tenantId) {
  const conexao = await conexaoDaLoja(tenantId)
  if (!conexao) throw new HttpError(409, 'A loja ainda não conectou a Webmotors.', 'Conecte em Integrações.')
  return conexao
}

async function gravaAnuncio(linha) {
  await db.upsert('webmotors_anuncios', [{ ...linha, atualizado_em: new Date().toISOString() }], 'car_id')
}

const NA_WEBMOTORS = ['publicado', 'enviando_fotos']

/**
 * Fotos: deixa na Webmotors as mesmas do painel. Envia como arquivo (a
 * Webmotors nao aceita link), uma por vez, ate acabar o tempo -- o resto vai na
 * proxima sincronizacao. Devolve { fotos, pendentes, aviso }.
 */
async function sincronizarFotos({ conexao, codigoAnuncio, fotosPainel, enviadas, inicio }) {
  const desejadas = fotosPainel.map((f) => f.id)
  let atual = [...enviadas]
  let aviso = null

  // Tirou a foto do painel: tira da Webmotors.
  for (const foto of enviadas.filter((f) => !desejadas.includes(f.id))) {
    if (Date.now() - inicio > ORCAMENTO_MS) break
    const r = await excluirFoto(conexao, codigoAnuncio, foto.codigo)
    if (r.ok) atual = atual.filter((f) => f.id !== foto.id)
  }

  for (const foto of fotosPainel) {
    if (atual.some((f) => f.id === foto.id)) continue
    if (Date.now() - inicio > ORCAMENTO_MS) break
    const arquivo = await baixarFoto(foto.url)
    if (arquivo.erro) {
      aviso = arquivo.erro
      atual.push({ id: foto.id, codigo: null, erro: arquivo.erro })
      continue
    }
    const r = await incluirFoto(conexao, codigoAnuncio, arquivo.bytes)
    if (r.ok) {
      atual.push({ id: foto.id, codigo: r.codigoFoto })
    } else {
      aviso = r.mensagem
      // Limite de fotos do plano ou plano sem foto: nao adianta insistir nas outras.
      if (['42|2', '42|3'].includes(String(r.codigo))) break
      atual.push({ id: foto.id, codigo: null, erro: r.mensagem })
    }
  }

  const pendentes = fotosPainel.filter((f) => !atual.some((a) => a.id === f.id)).length
  return { fotos: atual, pendentes, aviso }
}

/**
 * Deixa a Webmotors igual ao painel para um carro:
 * - disponivel e liberado para a Webmotors -> publica ou atualiza;
 * - sinal recebido, vendido, tirado da Webmotors ou excluido -> tira do ar.
 * `forcar` publica mesmo com "publicar tudo automaticamente" desligado.
 */
async function sincronizarCarro({ tenantId, conexao, carId, forcar = false, inicio = Date.now() }) {
  const [car, registro] = await Promise.all([
    db.selectOne('cars', `id=eq.${carId}&tenant_id=eq.${tenantId}&select=*`),
    db.selectOne('webmotors_anuncios', `car_id=eq.${carId}&tenant_id=eq.${tenantId}&select=*`),
  ])

  const jaNaWebmotors = Boolean(registro?.codigo_anuncio && NA_WEBMOTORS.includes(registro.situacao))
  const deveEstar =
    Boolean(car) &&
    car.status === 'ativo' &&
    car.wm_publicar !== false &&
    (conexao.publicar_tudo || forcar || jaNaWebmotors)

  if (!deveEstar) {
    if (!registro) return { situacao: 'fora' }
    if (!registro.codigo_anuncio || registro.situacao === 'removido') {
      if (registro.situacao !== 'removido') {
        await gravaAnuncio({ car_id: carId, tenant_id: tenantId, situacao: 'removido', mensagem: null })
      }
      return { situacao: 'removido' }
    }
    const motivo = car?.status === 'vendido' ? '2' : '3'
    const r = await excluirCarro(conexao, registro.codigo_anuncio, motivo)
    await gravaAnuncio({
      car_id: carId,
      tenant_id: tenantId,
      situacao: r.ok ? 'removido' : 'erro',
      mensagem: r.ok ? null : `Não consegui tirar da Webmotors: ${r.mensagem}`,
      ...(r.ok ? { codigo_anuncio: null, conteudo_hash: null, fotos: [] } : {}),
    })
    return { situacao: r.ok ? 'removido' : 'erro', mensagem: r.mensagem }
  }

  const codigoAtual = jaNaWebmotors ? registro.codigo_anuncio : 0
  const { xml, faltando } = await montarAnuncio({ car, conexao, codigoAnuncio: codigoAtual })

  if (faltando) {
    const mensagem = `Falta preencher: ${faltando.join(', ')}.${jaNaWebmotors ? ' O anúncio que já está na Webmotors continua como estava.' : ''}`
    await gravaAnuncio({
      car_id: carId,
      tenant_id: tenantId,
      situacao: jaNaWebmotors ? registro.situacao : 'incompleto',
      mensagem,
    })
    return { situacao: 'incompleto', mensagem, faltando }
  }

  const hash = hashDoAnuncio(xml)
  let codigoAnuncio = codigoAtual
  let fotosEnviadas = jaNaWebmotors && Array.isArray(registro.fotos) ? registro.fotos : []

  if (!jaNaWebmotors) {
    const r = await incluirCarro(conexao, xml)
    if (!r.ok) {
      await gravaAnuncio({ car_id: carId, tenant_id: tenantId, situacao: 'erro', mensagem: r.mensagem, conteudo_hash: null })
      return { situacao: 'erro', mensagem: r.mensagem }
    }
    codigoAnuncio = r.codigoAnuncio
    fotosEnviadas = []
    await gravaAnuncio({
      car_id: carId,
      tenant_id: tenantId,
      codigo_anuncio: codigoAnuncio,
      situacao: 'enviando_fotos',
      mensagem: null,
      conteudo_hash: hash,
      fotos: [],
    })
  } else if (registro.conteudo_hash !== hash) {
    const r = await alterarCarro(conexao, xml)
    if (!r.ok) {
      await gravaAnuncio({ car_id: carId, tenant_id: tenantId, situacao: registro.situacao, mensagem: `Não consegui atualizar: ${r.mensagem}` })
      return { situacao: 'erro', mensagem: r.mensagem }
    }
  }

  const fotosPainel = await db.select('car_photos', `car_id=eq.${carId}&select=id,url,ordem,is_cover&order=is_cover.desc,ordem.asc`)
  const { fotos, pendentes, aviso } = await sincronizarFotos({
    conexao,
    codigoAnuncio,
    fotosPainel,
    enviadas: fotosEnviadas,
    inicio,
  })

  const situacao = pendentes > 0 ? 'enviando_fotos' : 'publicado'
  const mensagem =
    pendentes > 0
      ? `Enviando as fotos para a Webmotors: faltam ${pendentes}. Continua sozinho na próxima atualização.`
      : aviso
  await gravaAnuncio({
    car_id: carId,
    tenant_id: tenantId,
    codigo_anuncio: codigoAnuncio,
    situacao,
    mensagem,
    conteudo_hash: hash,
    fotos,
  })
  return { situacao, mensagem }
}

// --- Situacao, conectar e desconectar ------------------------------------------------

router.get(
  '/status',
  route(async (req, res) => {
    await requireTenant(req)
    const configurada = webmotorsConfigurada()
    res.json({ configurada, ambiente: configurada ? webmotorsConfig().ambiente : null })
  }),
)

/** Conecta a loja com o usuario "Integrador de API" do Cockpit. */
router.post(
  '/conectar',
  route(async (req, res) => {
    const { tenant } = await requireTenant(req)
    webmotorsConfig()
    const cnpj = String(req.body.cnpj ?? '').replace(/\D/g, '')
    const email = String(req.body.email ?? '').trim()
    const senha = String(req.body.senha ?? '')
    if (cnpj.length !== 14) throw new HttpError(400, 'Informe o CNPJ da loja (14 números).')
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'Informe o e-mail do usuário "Integrador de API".')
    if (!senha) throw new HttpError(400, 'Informe a senha do usuário "Integrador de API".')

    const hash = await autenticar({ cnpj, email, senha })
    const anterior = await conexaoDaLoja(tenant.id)
    const linha = {
      tenant_id: tenant.id,
      cnpj,
      email,
      senha_cifrada: cifra(senha),
      hash_sessao: hash,
      hash_expira_em: new Date(Date.now() + 14 * 60 * 60 * 1000).toISOString(),
      modalidade_cod: anterior?.modalidade_cod ?? null,
      modalidade_nome: anterior?.modalidade_nome ?? null,
      publicar_tudo: anterior?.publicar_tudo ?? true,
      atualizado_em: new Date().toISOString(),
    }
    await db.upsert('webmotors_conexoes', [linha], 'tenant_id')

    // Plano da loja: com uma modalidade de usados so, ja deixa escolhida.
    let lista = []
    try {
      lista = await modalidades(linha)
    } catch {
      lista = []
    }
    const usados = lista.filter((m) => m.tipo !== 'N')
    if (!linha.modalidade_cod && usados.length === 1) {
      await db.update('webmotors_conexoes', `tenant_id=eq.${tenant.id}`, {
        modalidade_cod: usados[0].id,
        modalidade_nome: usados[0].nome,
      })
    }
    res.json({ ok: true, modalidades: lista })
  }),
)

/**
 * Desconecta a loja. Os anuncios que ja estao na Webmotors ficam la (a loja
 * tira pelo Cockpit, se quiser) -- o painel so para de mexer neles.
 */
router.post(
  '/desconectar',
  route(async (req, res) => {
    const { tenant } = await requireTenant(req)
    await db.delete('webmotors_conexoes', `tenant_id=eq.${tenant.id}`)
    res.json({ ok: true })
  }),
)

router.get(
  '/modalidades',
  route(async (req, res) => {
    const { tenant } = await requireTenant(req)
    const conexao = await exigeConexao(tenant.id)
    res.json({ itens: await modalidades(conexao) })
  }),
)

router.post(
  '/configurar',
  route(async (req, res) => {
    const { tenant } = await requireTenant(req)
    const conexao = await exigeConexao(tenant.id)
    const patch = { atualizado_em: new Date().toISOString() }

    if (req.body.modalidade_cod !== undefined) {
      const lista = await modalidades(conexao)
      const escolhida = lista.find((m) => m.id === Number(req.body.modalidade_cod))
      if (!escolhida) throw new HttpError(400, 'Esse plano não aparece na conta da loja na Webmotors.')
      patch.modalidade_cod = escolhida.id
      patch.modalidade_nome = escolhida.nome
    }
    if (typeof req.body.publicar_tudo === 'boolean') patch.publicar_tudo = req.body.publicar_tudo

    const [linha] = await db.update('webmotors_conexoes', `tenant_id=eq.${tenant.id}`, patch)
    res.json({
      ok: true,
      modalidade_cod: linha?.modalidade_cod ?? null,
      modalidade_nome: linha?.modalidade_nome ?? null,
      publicar_tudo: linha?.publicar_tudo ?? true,
    })
  }),
)

// --- Catalogo --------------------------------------------------------------------

router.post(
  '/sugerir',
  route(async (req, res) => {
    const { tenant } = await requireTenant(req)
    const conexao = await exigeConexao(tenant.id)
    const { brand, model, version, engine, transmission, model_year } = req.body
    res.json(await sugerirCatalogo(conexao, { brand, model, version, engine, transmission, model_year }))
  }),
)

router.get(
  '/catalogo',
  route(async (req, res) => {
    const { tenant } = await requireTenant(req)
    const conexao = await exigeConexao(tenant.id)
    const { marca, modelo, ano } = req.query
    if (marca && modelo) {
      const lista = await versoes(conexao, modelo, ano)
      return res.json({ itens: lista.map(({ id, nome }) => ({ id, nome })) })
    }
    if (marca) return res.json({ itens: await modelos(conexao, marca) })
    res.json({ itens: await marcas(conexao) })
  }),
)

// --- Publicar, tirar e acompanhar ----------------------------------------------------

const idValido = (valor) => /^[0-9a-f-]{36}$/i.test(String(valor || ''))

/** Chamado pelo painel depois de salvar, vender, dar sinal ou excluir um carro. */
router.post(
  '/sincronizar',
  route(async (req, res) => {
    const { tenant } = await requireTenant(req)
    const conexao = await conexaoDaLoja(tenant.id)
    if (!conexao) return res.json({ situacao: 'sem_conexao' })
    const carId = String(req.body.car_id || '')
    if (!idValido(carId)) throw new HttpError(400, 'Carro inválido.')
    res.json(await sincronizarCarro({ tenantId: tenant.id, conexao, carId, forcar: req.body.forcar === true }))
  }),
)

/**
 * Publica os carros disponiveis liberados para a Webmotors, ate acabar o tempo
 * da chamada. O painel chama de novo enquanto `restantes` for maior que zero.
 */
router.post(
  '/publicar-tudo',
  route(async (req, res) => {
    const { tenant } = await requireTenant(req)
    const conexao = await exigeConexao(tenant.id)
    const inicio = Date.now()

    const [carros, registros] = await Promise.all([
      db.select('cars', `tenant_id=eq.${tenant.id}&status=eq.ativo&wm_publicar=is.true&select=id&order=created_at.asc`),
      db.select('webmotors_anuncios', `tenant_id=eq.${tenant.id}&select=car_id,situacao`),
    ])
    const prontos = new Set(registros.filter((r) => r.situacao === 'publicado').map((r) => r.car_id))
    const fila = carros.filter((c) => !prontos.has(c.id))

    const resumo = { publicados: 0, incompletos: 0, comErro: 0, emAndamento: 0, restantes: 0, aviso: null }
    for (const [i, carro] of fila.entries()) {
      if (Date.now() - inicio > ORCAMENTO_MS) {
        resumo.restantes = fila.length - i
        break
      }
      try {
        const r = await sincronizarCarro({ tenantId: tenant.id, conexao, carId: carro.id, forcar: true, inicio })
        if (r.situacao === 'publicado') resumo.publicados++
        else if (r.situacao === 'incompleto') resumo.incompletos++
        else if (r.situacao === 'enviando_fotos') resumo.emAndamento++
        else if (r.situacao === 'erro') {
          resumo.comErro++
          resumo.aviso = r.mensagem ?? resumo.aviso
        }
      } catch (err) {
        resumo.comErro++
        resumo.aviso = err.message
        // Integrador ou Webmotors fora do ar: para aqui em vez de errar carro por carro.
        if (err instanceof HttpError && err.status >= 500) {
          resumo.restantes = fila.length - i - 1
          break
        }
      }
    }
    res.json(resumo)
  }),
)

/** Termina o que ficou pela metade (fotos que nao deram tempo de enviar). */
router.post(
  '/atualizar',
  route(async (req, res) => {
    const { tenant } = await requireTenant(req)
    const conexao = await conexaoDaLoja(tenant.id)
    if (!conexao) return res.json({ atualizados: 0 })
    const inicio = Date.now()
    const pendentes = await db.select(
      'webmotors_anuncios',
      `tenant_id=eq.${tenant.id}&situacao=eq.enviando_fotos&select=car_id&limit=5`,
    )
    let atualizados = 0
    for (const linha of pendentes) {
      if (Date.now() - inicio > ORCAMENTO_MS) break
      try {
        await sincronizarCarro({ tenantId: tenant.id, conexao, carId: linha.car_id, inicio })
        atualizados++
      } catch {
        break
      }
    }
    res.json({ atualizados })
  }),
)

export default router
