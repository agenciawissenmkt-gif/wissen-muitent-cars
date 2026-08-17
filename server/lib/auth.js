import { db, getUserFromToken, HttpError } from './db.js'

/**
 * Toda rota exige o access token do Supabase e a posse da loja: o usuário só
 * provisiona integrações do tenant vinculado à própria `stores.owner_id`.
 * Devolve a loja, o tenant e as configurações já carregados.
 */
export async function requireTenant(req) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null

  if (!token) throw new HttpError(401, 'Sessão não informada. Faça login novamente.')

  const user = await getUserFromToken(token)
  if (!user?.id) throw new HttpError(401, 'Sessão inválida ou expirada. Faça login novamente.')

  const tenantId = req.body?.tenant_id || req.query?.tenant_id
  if (!tenantId) throw new HttpError(400, 'tenant_id é obrigatório.')

  const store = await db.selectOne('stores', `tenant_id=eq.${tenantId}&owner_id=eq.${user.id}&select=*`)
  if (!store) throw new HttpError(403, 'Loja não encontrada para este usuário.')

  const [tenant, settings] = await Promise.all([
    db.selectOne('tenants', `id=eq.${tenantId}&select=*`),
    db.selectOne('tenant_settings', `tenant_id=eq.${tenantId}&select=*`),
  ])

  if (!tenant) throw new HttpError(404, 'Tenant não encontrado.')

  return { user, store, tenant, settings: settings ?? {} }
}

/** Envolve o handler async e transforma HttpError em resposta JSON. */
export function route(handler) {
  return async (req, res) => {
    try {
      await handler(req, res)
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      if (status >= 500) console.error('[wissen-cars]', error)
      res.status(status).json({
        error: error.message || 'Erro interno.',
        ...(error.hint ? { hint: error.hint } : {}),
      })
    }
  }
}
