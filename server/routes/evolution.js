import { Router } from 'express'
import { db, HttpError, upsertChannel } from '../lib/db.js'
import { requireTenant, route } from '../lib/auth.js'
import { findInboxByName } from '../lib/chatwoot-account.js'

const router = Router()

/**
 * A Evolution valida a URL do Chatwoot com um parser estrito e recusa hostname
 * com underscore ("url is not valid") — que é justamente o nome do serviço no
 * Docker (http://wissen_chatwoot:3000). Quando isso acontece, caímos para o
 * endereço público, que a Evolution alcança do mesmo jeito.
 */
function hostnameValidoParaEvolution(url) {
  try {
    return !new URL(url).hostname.includes('_')
  } catch {
    return false
  }
}

function escolheUrlDoChatwoot(settings) {
  const candidatas = [
    settings?.chatwoot_base_url,
    process.env.CHATWOOT_INTERNAL_URL,
    process.env.CHATWOOT_BASE_URL,
  ]
  return candidatas.find((url) => url && hostnameValidoParaEvolution(url)) || null
}

/** Modo simulação: permite testar a etapa 4 (QR + comemoração) sem Evolution API. */
const SIMULATE = process.env.WISSEN_SIMULATE === 'true'
const SIMULATED_CONNECT_MS = 12_000
const simulated = new Map()

/** A URL da Evolution pode vir das configurações da loja ou do ambiente. */
function evolutionConfig(settings) {
  const baseUrl = (settings?.evolution_base_url || process.env.EVOLUTION_API_URL || '').replace(/\/$/, '')
  const apiKey = (process.env.EVOLUTION_API_KEY || '').trim()

  if (!baseUrl || !apiKey) {
    if (SIMULATE) return null
    throw new HttpError(
      501,
      'Evolution API não configurada.',
      'Defina EVOLUTION_API_KEY em server/.env (a URL pode vir de tenant_settings.evolution_base_url) — ou WISSEN_SIMULATE=true para testar o fluxo sem WhatsApp real.',
    )
  }

  return { baseUrl, apiKey }
}

async function evolution(config, path, { method = 'GET', body } = {}) {
  const res = await fetch(`${config.baseUrl}/${path}`, {
    method,
    headers: { apikey: config.apiKey, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { message: text.slice(0, 200) }
  }

  if (!res.ok) {
    const message = data?.response?.message || data?.message || data?.error || 'Erro (' + res.status + ')'
    const texto = Array.isArray(message) ? message.join(', ') : message
    let host = config.baseUrl
    try { host = new URL(config.baseUrl).host } catch { /* mantem como veio */ }
    // Sem esta pista o erro vira caca ao tesouro: 'Unauthorized' pode ser a
    // chave da Evolution OU o token do Chatwoot que a Evolution repassa.
    throw new HttpError(502, 'Evolution API: ' + texto, method + ' ' + host + '/' + path + ' - HTTP ' + res.status)
  }

  return data
}

/**
 * O UNICO lugar que pode chamar instance/connect.
 *
 * Na Evolution `GET /instance/connect/:nome` NAO e leitura: ele abre um socket
 * novo do Baileys para aquela sessao. O WhatsApp so aceita um socket por
 * sessao — quando um segundo autentica, o primeiro cai com statusCode 440
 * ("conflict", "type: replaced") e o Baileys tenta reconectar, o que colide com
 * a proxima chamada. Era exatamente esse o loop que derrubava a conexao criada
 * pelo painel: o polling da etapa 4 chamava /state de 3 em 3 segundos e /state
 * chamava connect toda vez.
 *
 * Regras aqui:
 *   - so conecta quando o estado e 'close' (nao existe socket);
 *   - nunca conecta em 'connecting' (ou ja tem QR na tela, ou o aparelho acabou
 *     de parear e a sessao esta subindo — conectar aqui e o que gera o replaced);
 *   - trava de tempo por instancia, para que nenhuma aba extra fure a regra.
 */
const CONNECT_COOLDOWN_MS = 30_000
const ultimoConnect = new Map()

function podeConectar(name) {
  const anterior = ultimoConnect.get(name)
  return !anterior || Date.now() - anterior >= CONNECT_COOLDOWN_MS
}

async function conectaUmaVez(config, name, { forcar = false } = {}) {
  // `forcar` e so para a acao deliberada do lojista (botao "Gerar QR Code"),
  // que roda uma vez por clique e sempre com a instancia em 'close'. O polling
  // nunca forca — e a trava que o impede de virar um laco de sockets.
  if (!forcar && !podeConectar(name)) return null
  ultimoConnect.set(name, Date.now())
  return evolution(config, `instance/connect/${name}`)
}

/** 'open' | 'connecting' | 'close' — 'close' tambem cobre instancia inexistente. */
async function estadoAtual(config, name) {
  const data = await evolution(config, `instance/connectionState/${name}`).catch(() => null)
  return data?.instance?.state ?? data?.state ?? 'close'
}

function instanceName(tenant) {
  return `wissen-${tenant.slug}`.slice(0, 60)
}

/** Extrai o QR em base64 das várias formas que a Evolution devolve. */
function readQrCode(payload) {
  const raw = payload?.qrcode?.base64 ?? payload?.qrcode?.code ?? payload?.base64 ?? payload?.code ?? null
  if (!raw) return null
  return String(raw).startsWith('data:') ? raw : `data:image/png;base64,${raw}`
}

function simulatedQr(name) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240">
<rect width="240" height="240" fill="#fff"/>
<g fill="#0F172A">${Array.from({ length: 144 })
    .map((_, i) => {
      const x = (i % 12) * 20
      const y = Math.floor(i / 12) * 20
      return (i * 7 + name.length * 3) % 3 !== 0 ? `<rect x="${x}" y="${y}" width="20" height="20"/>` : ''
    })
    .join('')}</g>
<rect x="80" y="90" width="80" height="60" rx="8" fill="#7C3AED"/>
<text x="120" y="126" font-family="sans-serif" font-size="12" fill="#fff" text-anchor="middle">SIMULAÇÃO</text>
</svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

/**
 * Descobre a inbox criada pela integração no Chatwoot. O par
 * (chatwoot_account_id, chatwoot_inbox_id) é o que resolve_tenant() usa no N8N.
 */
/**
 * A Evolution usa este token para criar a inbox no Chatwoot. Se ele for de um
 * Agent Bot (que nao pode usar a API de conta), o Chatwoot devolve 401 e a
 * Evolution repassa como "Unauthorized" - um erro que PARECE da Evolution e
 * manda a investigacao para o lado errado. Conferimos antes e falamos claro.
 */
async function garanteTokenDeAdmin(settings, accountId) {
  const baseUrl = settings?.chatwoot_base_url
  if (!baseUrl || !settings?.chatwoot_token || !accountId) return

  let res
  try {
    res = await fetch(baseUrl + '/api/v1/accounts/' + accountId + '/inboxes', {
      headers: { api_access_token: settings.chatwoot_token },
    })
  } catch {
    return // rede instavel nao e motivo para travar a etapa
  }

  if (res.status === 401 || res.status === 403) {
    throw new HttpError(
      400,
      'O token salvo da central nao tem permissao de administrador.',
      'Provavelmente e o token de um Agent Bot. Limpe tenant_settings.chatwoot_token e refaca a etapa 3 para gerar o token certo.',
    )
  }
}

/**
 * A Chatwoot fala com a Evolution pela webhook_url da inbox. Quem cria essa URL
 * e o chatwoot/set, mas SO na primeira vez: quando ja existe uma inbox com o
 * mesmo nome, a Evolution reaproveita a inbox e nao reescreve a URL.
 *
 * Como a inbox tem o nome da loja e sobrevive a exclusao da instancia, um
 * "reconectar outro numero" deixa a inbox apontando para a instancia ANTIGA.
 * O resultado engana: a mensagem do cliente chega (esse caminho e a Evolution
 * empurrando para a Chatwoot com o token da conta), a Julia responde, a resposta
 * entra na Chatwoot com visto de enviada — e morre num endereco que nao existe
 * mais. Ninguem recebe nada no WhatsApp.
 *
 * Por isso conferimos e corrigimos a URL toda vez que ligamos uma instancia.
 */
async function garanteWebhookDaInbox({ settings, accountId, inboxId, evolutionBaseUrl, name }) {
  if (!settings?.chatwoot_base_url || !settings?.chatwoot_token || !accountId || !inboxId) return
  if (!evolutionBaseUrl || !name) return

  const esperado = evolutionBaseUrl + '/chatwoot/webhook/' + name

  try {
    const endereco = settings.chatwoot_base_url + '/api/v1/accounts/' + accountId + '/inboxes/' + inboxId
    const atualRes = await fetch(endereco, { headers: { api_access_token: settings.chatwoot_token } })
    if (!atualRes.ok) return

    const inbox = await atualRes.json()
    const atual = inbox?.webhook_url ?? inbox?.channel?.webhook_url ?? null
    if (atual === esperado) return

    await fetch(endereco, {
      method: 'PATCH',
      headers: { api_access_token: settings.chatwoot_token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: { webhook_url: esperado } }),
    })
  } catch {
    // Nao vale travar a conexao do WhatsApp por causa disso; o monitor acusa depois.
  }
}

async function findInboxId(settings, tenant, accountId) {
  if (!settings?.chatwoot_base_url || !settings?.chatwoot_token || !accountId) return null

  try {
    const res = await fetch(`${settings.chatwoot_base_url}/api/v1/accounts/${accountId}/inboxes`, {
      headers: { api_access_token: settings.chatwoot_token },
    })
    if (!res.ok) return null

    const data = await res.json()
    const inboxes = data?.payload ?? []
    const match = inboxes.find((inbox) => String(inbox.name).includes(tenant.slug)) ?? inboxes[0]
    return match?.id ?? null
  } catch {
    return null
  }
}

// --- Criação da instância ----------------------------------------------------

router.post(
  '/instance',
  route(async (req, res) => {
    const { tenant, settings } = await requireTenant(req)
    const channel = await db.selectOne('tenant_channels', `tenant_id=eq.${tenant.id}&select=*`)
    const name = channel?.evolution_instance || instanceName(tenant)
    const config = evolutionConfig(settings)

    if (!config) {
      simulated.set(name, Date.now())
      await upsertChannel(tenant.id, {
        evolution_instance: name,
        whatsapp_number: settings?.bot_phone ?? null,
        chatwoot_account_id: channel?.chatwoot_account_id ?? null,
      })
      res.json({ instance: name, status: 'aguardando_leitura', qrcode: simulatedQr(name), simulated: true })
      return
    }

    // A loja pode já ter um WhatsApp pareado (instância criada fora do painel).
    // Nesse caso não faz sentido pedir QR de novo: adotamos a instância existente.
    const estado = await estadoAtual(config, name)
    if (estado === 'open') {
      const inboxId = channel?.chatwoot_inbox_id ?? (await findInboxId(settings, tenant, channel?.chatwoot_account_id))
      await upsertChannel(tenant.id, {
        evolution_instance: name,
        whatsapp_number: settings?.bot_phone ?? null,
        chatwoot_account_id: channel?.chatwoot_account_id ?? null,
        ativo: true,
        ...(inboxId ? { chatwoot_inbox_id: inboxId } : {}),
      })
      await db.upsert('tenant_settings', [{ tenant_id: tenant.id, evolution_instance: name }], 'tenant_id')
      await garanteWebhookDaInbox({
        settings,
        accountId: channel?.chatwoot_account_id,
        inboxId,
        evolutionBaseUrl: config.baseUrl,
        name,
      })

      res.json({ instance: name, status: 'conectado', qrcode: null, inbox_id: inboxId })
      return
    }

    // Já existe um socket vivo para esta instância (QR na tela em outra aba, ou
    // o aparelho acabou de parear e a sessão está subindo). Recriar, reconfigurar
    // o Chatwoot — que reinicia a instância — ou pedir connect de novo abriria um
    // SEGUNDO controlador para a mesma sessão, e o WhatsApp derruba o primeiro
    // com "conflict / replaced". Devolvemos o estado e deixamos o polling seguir.
    if (estado === 'connecting') {
      res.json({ instance: name, status: 'aguardando_leitura', qrcode: null, ja_conectando: true })
      return
    }

    // Criamos SEM pedir QR de propósito. Configurar o Chatwoot logo abaixo
    // reinicia a instância na Evolution: um QR gerado agora seria de um socket
    // que morre no restart, e o lojista pareia numa sessão que cai em seguida.
    // O QR sai só no final, depois de tudo configurado.
    //
    // Também não mandamos `number`: com ele a Evolution amarra a instância
    // àquele telefone e troca para pareamento por código. Qualquer divergência
    // de formato (o 9 extra do celular, por exemplo) invalida a sessão logo
    // depois de parear. Com QR puro quem manda é o aparelho que escaneia.
    let created = null
    try {
      created = await evolution(config, 'instance/create', {
        method: 'POST',
        body: {
          instanceName: name,
          qrcode: false,
          integration: 'WHATSAPP-BAILEYS',
        },
      })
    } catch (error) {
      if (!/already|exists|in use/i.test(error.message)) throw error
    }

    // Liga a instância à central da loja (cria a inbox no Chatwoot).
    // A URL aqui é a que a Evolution vai usar para falar com o Chatwoot: o host
    // interno do Docker quando existir, senão o endereço público.
    const inboxName = `wissen-${tenant.slug}`
    const chatwootUrlParaEvolution = escolheUrlDoChatwoot(settings)

    // chatwoot/set REINICIA a instância na Evolution. Rodar isso numa retentativa
    // em que a inbox já existe é um restart de graça — e restart no meio de um
    // pareamento é uma das formas de provocar o "replaced". Só configuramos
    // quando a instância acabou de nascer ou quando a inbox ainda não existe.
    const precisaConfigurarChatwoot = Boolean(created) || !channel?.chatwoot_inbox_id

    if (precisaConfigurarChatwoot && channel?.chatwoot_account_id && chatwootUrlParaEvolution && settings?.chatwoot_token) {
      await garanteTokenDeAdmin(settings, channel.chatwoot_account_id)
      await evolution(config, `chatwoot/set/${name}`, {
        method: 'POST',
        body: {
          enabled: true,
          accountId: String(channel.chatwoot_account_id),
          token: settings.chatwoot_token,
          url: chatwootUrlParaEvolution,
          signMsg: false,
          reopenConversation: true,
          conversationPending: false,
          nameInbox: inboxName,
          importContacts: false,
          importMessages: false,
          mergeBrazilContacts: true,
          autoCreate: true,
        },
      })
    } else if (precisaConfigurarChatwoot && channel?.chatwoot_account_id && !settings?.chatwoot_token) {
      // Falhar aqui é melhor do que entregar uma loja muda: sem essa ligação as
      // mensagens do WhatsApp nunca chegam ao Chatwoot nem ao agente.
      throw new HttpError(
        400,
        'A central ainda não tem token de administrador.',
        'Refaça a etapa 3 (criar central) para gerar o token antes de conectar o WhatsApp.',
      )
    }

    // Agora sim: o QR nasce depois do restart provocado pelo chatwoot/set.
    // Este é o connect legítimo do fluxo — e o único que o painel dispara.
    const connect = await conectaUmaVez(config, name, { forcar: true })
    const qrcode = readQrCode(connect) ?? readQrCode(created)

    // A inbox é criada pela Evolution; sem guardar o id aqui a RPC
    // tenant_context(account_id, inbox_id) não acha o tenant e o agente ignora
    // a conversa.
    let inboxId = channel?.chatwoot_inbox_id ?? null
    if (channel?.chatwoot_account_id && settings?.chatwoot_token) {
      const inbox = await findInboxByName(channel.chatwoot_account_id, settings.chatwoot_token, inboxName).catch(
        () => null,
      )
      if (inbox?.id) inboxId = inbox.id
    }

    await upsertChannel(tenant.id, {
      evolution_instance: name,
      whatsapp_number: settings?.bot_phone ?? null,
      chatwoot_account_id: channel?.chatwoot_account_id ?? null,
      chatwoot_inbox_id: inboxId,
    })
    await db.upsert('tenant_settings', [{ tenant_id: tenant.id, evolution_instance: name }], 'tenant_id')
    await garanteWebhookDaInbox({
      settings,
      accountId: channel?.chatwoot_account_id,
      inboxId,
      evolutionBaseUrl: config.baseUrl,
      name,
    })

    res.json({ instance: name, status: 'aguardando_leitura', qrcode, chatwoot_inbox_id: inboxId })
  }),
)

// --- Status / renovação do QR ------------------------------------------------

router.get(
  '/state',
  route(async (req, res) => {
    const { tenant, settings } = await requireTenant(req)
    const channel = await db.selectOne('tenant_channels', `tenant_id=eq.${tenant.id}&select=*`)
    const name = channel?.evolution_instance || instanceName(tenant)
    const config = evolutionConfig(settings)

    if (!config) {
      const startedAt = simulated.get(name)
      const connected = startedAt && Date.now() - startedAt > SIMULATED_CONNECT_MS
      if (connected) await upsertChannel(tenant.id, { ativo: true })

      res.json({
        instance: name,
        status: connected ? 'conectado' : 'aguardando_leitura',
        qrcode: connected ? null : simulatedQr(name),
        simulated: true,
      })
      return
    }

    const rawState = await estadoAtual(config, name)

    if (rawState === 'open') {
      const inboxId = channel?.chatwoot_inbox_id ?? (await findInboxId(settings, tenant, channel?.chatwoot_account_id))
      await upsertChannel(tenant.id, {
        ativo: true,
        ...(inboxId ? { chatwoot_inbox_id: inboxId } : {}),
      })
      res.json({ instance: name, status: 'conectado', qrcode: null, inbox_id: inboxId })
      return
    }

    // 'connecting': o socket está de pé. Esta rota é chamada em laço pelo front,
    // então aqui ela é SÓ leitura — pedir connect agora é o que criava o segundo
    // controlador e derrubava a sessão recém-pareada com "conflict / replaced".
    // O QR que o lojista está vendo veio do POST /instance e continua valendo.
    if (rawState === 'connecting') {
      res.json({ instance: name, status: 'aguardando_leitura', qrcode: null })
      return
    }

    // 'close': não há socket nenhum. Reconectar aqui é legítimo, mas com a trava
    // de tempo — senão o polling volta a ser uma fábrica de sockets.
    const connect = await conectaUmaVez(config, name).catch(() => null)
    res.json({ instance: name, status: 'aguardando_leitura', qrcode: readQrCode(connect) })
  }),
)

// --- Desconectar -------------------------------------------------------------

router.post(
  '/disconnect',
  route(async (req, res) => {
    const { tenant, settings } = await requireTenant(req)
    const channel = await db.selectOne('tenant_channels', `tenant_id=eq.${tenant.id}&select=*`)
    const name = channel?.evolution_instance || instanceName(tenant)
    const config = evolutionConfig(settings)

    if (config) {
      await evolution(config, `instance/logout/${name}`, { method: 'DELETE' }).catch(() => undefined)
      await evolution(config, `instance/delete/${name}`, { method: 'DELETE' }).catch(() => undefined)
      ultimoConnect.delete(name)
    } else {
      simulated.delete(name)
    }

    if (channel) {
      await db.update('tenant_channels', `id=eq.${channel.id}`, { ativo: false, evolution_instance: null })
    }

    res.json({ ok: true })
  }),
)

export default router
