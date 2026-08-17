/**
 * Acesso ao Supabase pela REST API com a service role key. Fica só no servidor:
 * essa chave ignora RLS e nunca pode chegar ao navegador.
 */

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

export function supabaseConfigured() {
  return Boolean(SUPABASE_URL && SERVICE_KEY)
}

export class HttpError extends Error {
  constructor(status, message, hint) {
    super(message)
    this.status = status
    this.hint = hint
  }
}

export function requireSupabase() {
  if (!supabaseConfigured()) {
    throw new HttpError(
      501,
      'Servidor sem acesso ao Supabase.',
      'Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no arquivo server/.env.',
    )
  }
}

async function rest(path, { method = 'GET', body, prefer } = {}) {
  requireSupabase()

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const text = await res.text()
  const data = text ? JSON.parse(text) : null

  if (!res.ok) {
    throw new HttpError(res.status, data?.message || `Erro do Supabase (${res.status})`, data?.hint || data?.details)
  }

  return data
}

export const db = {
  select: (table, query) => rest(`${table}?${query}`),
  async selectOne(table, query) {
    const rows = await rest(`${table}?${query}&limit=1`)
    return rows?.[0] ?? null
  },
  insert: (table, values) => rest(table, { method: 'POST', body: values, prefer: 'return=representation' }),
  update: (table, query, values) =>
    rest(`${table}?${query}`, { method: 'PATCH', body: values, prefer: 'return=representation' }),
  upsert: (table, values, onConflict) =>
    rest(`${table}?on_conflict=${onConflict}`, {
      method: 'POST',
      body: values,
      prefer: 'return=representation,resolution=merge-duplicates',
    }),
  delete: (table, query) => rest(`${table}?${query}`, { method: 'DELETE' }),
}

/**
 * Cria ou atualiza o canal (Chatwoot + Evolution) da loja — um por tenant.
 * `tenant_channels.chatwoot_account_id` é NOT NULL, então a criação do canal só
 * acontece depois da etapa 3 (provisionamento da central).
 */
export async function upsertChannel(tenantId, patch) {
  const existing = await db.selectOne('tenant_channels', `tenant_id=eq.${tenantId}&select=*`)

  if (existing) {
    const [row] = await db.update('tenant_channels', `id=eq.${existing.id}`, patch)
    return row
  }

  if (!patch.chatwoot_account_id) {
    throw new HttpError(
      400,
      'A central de atendimento ainda não foi criada.',
      'Volte à etapa 3 e crie a central no Chatwoot antes de conectar o WhatsApp.',
    )
  }

  const [row] = await db.insert('tenant_channels', [{ tenant_id: tenantId, ...patch }])
  return row
}

/** Valida o access token do Supabase enviado pelo front e devolve o usuário. */
export async function getUserFromToken(token) {
  requireSupabase()

  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
  })

  if (!res.ok) return null
  return res.json()
}
