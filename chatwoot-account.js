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

/** Procura a inbox criada pela Evolution (ela nomeia a inbox com `nameInbox`). */
export async function findInboxByName(accountId, token, name) {
  const data = await accountApi(accountId, 'inboxes', { token })
  const list = Array.isArray(data) ? data : (data?.payload ?? [])
  return list.find((inbox) => inbox?.name === name) ?? null
}

/**
 * Garante que a conta tenha um webhook apontando para o fluxo do agente no n8n.
 * É isso que acorda a IA: o Chatwoot avisa o n8n a cada mensagem nova.
 */
export async function ensureAgentWebhook(accountId, token) {
  const url = process.env.N8N_AGENT_WEBHOOK_URL
  if (!url) return { skipped: 'N8N_AGENT_WEBHOOK_URL não definida' }

  const data = await accountApi(accountId, 'webhooks', { token })
  const list = Array.isArray(data) ? data : (data?.payload ?? [])
  const existing = list.find((hook) => hook?.url === url)
  if (existing) return { id: existing.id, created: false }

  const created = await accountApi(accountId, 'webhooks', {
    method: 'POST',
    token,
    body: { webhook: { url, subscriptions: ['message_created'] } },
  })

  return { id: created?.payload?.id ?? created?.id ?? null, created: true }
}
