import { supabase } from './supabase'

/**
 * Chamadas ao back-end de provisionamento (server/index.js). Ele existe para que
 * as chaves de Chatwoot Super Admin, Evolution API e Google OAuth nunca cheguem
 * ao navegador. Todas as rotas exigem o access token do Supabase.
 */

export class ApiError extends Error {
  status: number
  hint?: string

  constructor(message: string, status: number, hint?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.hint = hint
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token

  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  })

  const text = await res.text()
  const payload = text ? safeJson(text) : null

  if (!res.ok) {
    const body = (payload ?? {}) as { error?: unknown; hint?: unknown }
    const message = body.error ? String(body.error) : `Falha na requisição (${res.status})`
    throw new ApiError(message, res.status, body.hint ? String(body.hint) : undefined)
  }

  return payload as T
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return { error: text.slice(0, 300) }
  }
}

// --- Google Agenda ----------------------------------------------------------

export function googleAuthUrl(tenantId: string) {
  return request<{ url: string }>(`/google/auth-url?tenant_id=${encodeURIComponent(tenantId)}`)
}

export function googleDisconnect(tenantId: string) {
  return request<{ ok: true }>('/google/disconnect', {
    method: 'POST',
    body: JSON.stringify({ tenant_id: tenantId }),
  })
}

// --- Chatwoot ---------------------------------------------------------------

export interface ChatwootProvisionResult {
  account_id: number
  users: { email: string; chatwoot_user_id: number; role: string; invited: boolean }[]
  /** Preenchido quando a central existe mas não pode ser administrada pelo painel. */
  warning?: string
}

export function provisionChatwoot(tenantId: string) {
  return request<ChatwootProvisionResult>('/chatwoot/provision', {
    method: 'POST',
    body: JSON.stringify({ tenant_id: tenantId }),
  })
}

// --- Evolution API (WhatsApp) ----------------------------------------------

export interface EvolutionState {
  instance: string
  status: 'pendente' | 'aguardando_leitura' | 'conectado' | 'desconectado'
  qrcode?: string | null
  inbox_id?: number | null
  simulated?: boolean
}

export function createWhatsappInstance(tenantId: string) {
  return request<EvolutionState>('/evolution/instance', {
    method: 'POST',
    body: JSON.stringify({ tenant_id: tenantId }),
  })
}

export function whatsappState(tenantId: string) {
  return request<EvolutionState>(`/evolution/state?tenant_id=${encodeURIComponent(tenantId)}`)
}

export function disconnectWhatsapp(tenantId: string) {
  return request<{ ok: true }>('/evolution/disconnect', {
    method: 'POST',
    body: JSON.stringify({ tenant_id: tenantId }),
  })
}

// --- N8N --------------------------------------------------------------------

export function completeProvisioning(tenantId: string) {
  return request<{ ok: true; forwarded: boolean; payload: unknown }>('/provisioning/complete', {
    method: 'POST',
    body: JSON.stringify({ tenant_id: tenantId }),
  })
}
