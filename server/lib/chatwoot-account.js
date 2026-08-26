/**
 * Chamadas à API de conta do Chatwoot (`/api/v1/accounts/...`), que exigem um
 * `api_access_token` de um usuário administrador daquela conta — diferente da
 * Platform API, que usa a chave de Super Admin.
 *
 * Importante: aqui sempre usamos a URL pública (CHATWOOT_BASE_URL). O endereço
 * interno do Docker guardado em `tenant_settings.chatwoot_base_url` serve para
 * a Evolution e o n8n, que rodam na mesma rede — este servidor está na Vercel e
 * não enxerga aquele host.
 */
import { HttpError } from './db.js'

function publicBaseUrl() {
  return (process.env.CHATWOOT_BASE_URL || '').replace(/\/$/, '')
}

async function accountApi(accountId, path, { method = 'GET', body, token } = {}) {
  if (!token) throw new HttpError(400, 'Central sem token de administrador.', 'Refaça a etapa 3 (criar central).')

  const res = await fetch(`${publicBaseUrl()}/api/v1/accounts/${accountId}/${path}`, {
    method,
    headers: { api_access_token: token, 'Content-Type': 'application/json' },
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
    const message = data?.message || data?.error || `Erro do Chatwoot (${res.status})`
    const error = new HttpError(res.status === 401 ? 502 : res.status, `Chatwoot: ${message}`)
    error.chatwootStatus = res.status
    throw error
  }

  return data
}

/**
 * O Chatwoot não é consistente: `inboxes` devolve `{payload: [...]}`, mas
 * `webhooks` devolve `{payload: {webhooks: [...]}}`. Esta função aceita as três
 * formas e sempre entrega um array — sem ela, um `.find` estoura a etapa 3.
 */
function comoLista(data, chave) {
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.payload)) return data.payload
  if (chave && Array.isArray(data?.payload?.[chave])) return data.payload[chave]
  if (chave && Array.isArray(data?.[chave])) return data[chave]
  return []
}

/** Procura a inbox criada pela Evolution (ela nomeia a inbox com `nameInbox`). */
export async function findInboxByName(accountId, token, name) {
  const data = await accountApi(accountId, 'inboxes', { token })
  return comoLista(data, 'inboxes').find((inbox) => inbox?.name === name) ?? null
}

/**
 * Garante que a conta tenha um webhook apontando para o fluxo do agente no n8n.
 * É isso que acorda a IA: o Chatwoot avisa o n8n a cada mensagem nova.
 */
export async function ensureAgentWebhook(accountId, token) {
  const url = process.env.N8N_AGENT_WEBHOOK_URL
  if (!url) return { skipped: 'N8N_AGENT_WEBHOOK_URL não definida' }

  const data = await accountApi(accountId, 'webhooks', { token })
  const existing = comoLista(data, 'webhooks').find((hook) => hook?.url === url)
  if (existing) return { id: existing.id, created: false }

  const created = await accountApi(accountId, 'webhooks', {
    method: 'POST',
    token,
    body: { webhook: { url, subscriptions: ['message_created'] } },
  })

  return { id: created?.payload?.id ?? created?.id ?? null, created: true }
}

/** Agentes que ja existem na conta da loja (para avisar sobre e-mail repetido). */
export async function listAccountAgents(accountId, token) {
  const data = await accountApi(accountId, 'agents', { token })
  return comoLista(data, 'agents')
}

/**
 * O seletor "Agente atribuido" de uma conversa nao lista todos os agentes da
 * conta: lista quem e MEMBRO daquela inbox. Um vendedor cadastrado no painel
 * virava agente da conta e mesmo assim nao aparecia ali — nem para o dono da
 * loja escolher, nem para a Julia transferir. Por isso, toda vez que a equipe
 * e sincronizada, garantimos que ela seja membro da inbox do WhatsApp.
 *
 * O POST do Chatwoot substitui a lista, entao mandamos a uniao entre quem ja
 * esta la e quem falta — nunca so os novos.
 */
export async function ensureInboxMembers(accountId, token, inboxId, userIds) {
  const desejados = [...new Set((userIds || []).filter(Boolean).map(Number))]
  if (!inboxId || desejados.length === 0) return { skipped: 'sem inbox ou sem equipe' }

  let atuais = []
  try {
    const data = await accountApi(accountId, 'inbox_members/' + inboxId, { token })
    atuais = comoLista(data, 'inbox_members').map((u) => Number(u?.id)).filter(Boolean)
  } catch {
    // inbox recem-criada ainda pode nao responder aqui; seguimos com a lista nova
  }

  const uniao = [...new Set([...atuais, ...desejados])]
  if (uniao.length === atuais.length && desejados.every((id) => atuais.includes(id))) {
    return { inbox_id: inboxId, membros: atuais.length, alterado: false }
  }

  await accountApi(accountId, 'inbox_members', {
    method: 'POST',
    token,
    body: { inbox_id: inboxId, user_ids: uniao },
  })

  return { inbox_id: inboxId, membros: uniao.length, alterado: true }
}

/**
 * Convida alguem como agente pela API da CONTA (nao pela Platform API).
 *
 * E o mesmo caminho da tela "Configuracoes > Agentes" do Chatwoot, e o unico
 * que funciona quando a conta nao foi criada por este painel -- ali o Platform
 * App nao tem permissao para criar usuario. O Chatwoot manda o convite por
 * e-mail para a pessoa definir a propria senha.
 */
export async function createAccountAgent(accountId, token, { name, email, role }) {
  const data = await accountApi(accountId, 'agents', {
    method: 'POST',
    token,
    body: { name, email, role },
  })
  return data?.id ? data : (data?.payload ?? data)
}
