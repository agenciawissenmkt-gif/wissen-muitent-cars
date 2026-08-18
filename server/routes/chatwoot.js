import { Router } from 'express'
import crypto from 'node:crypto'
import { db, HttpError, upsertChannel } from '../lib/db.js'
import { requireTenant, route } from '../lib/auth.js'
import { ensureAgentWebhook } from '../lib/chatwoot-account.js'

const router = Router()

export function chatwootConfig() {
  const baseUrl = (process.env.CHATWOOT_BASE_URL || '').replace(/\/$/, '')
  const platformToken = process.env.CHATWOOT_PLATFORM_TOKEN

  if (!baseUrl || !platformToken) {
    throw new HttpError(
      501,
      'Chatwoot não configurado no servidor.',
      'Defina CHATWOOT_BASE_URL e CHATWOOT_PLATFORM_TOKEN (chave Super Admin) em server/.env.',
    )
  }

  return { baseUrl, platformToken }
}

async function platform(path, { method = 'GET', body } = {}) {
  const { baseUrl, platformToken } = chatwootConfig()

  const res = await fetch(`${baseUrl}/platform/api/v1/${path}`, {
    method,
    headers: { api_access_token: platformToken, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const text = await res.text()
  const data = text ? safeJson(text) : null

  if (!res.ok) {
    const message = data?.message || data?.error || `Erro do Chatwoot (${res.status})`
    const error = new HttpError(res.status === 401 ? 502 : res.status, `Chatwoot: ${message}`)
    error.chatwootStatus = res.status // o status original, antes do remapeamento
    throw error
  }

  return data
}

/**
 * Um Platform App só administra as contas que ele mesmo criou: numa conta criada
 * à mão o Chatwoot devolve 401 "Non permissible resource". Descobrimos isso com
 * um POST de corpo inválido — 422 significa que a conta é administrável.
 */
async function canManageAccount(accountId) {
  try {
    await platform(`accounts/${accountId}/account_users`, { method: 'POST', body: {} })
    return true
  } catch (error) {
    if (error.chatwootStatus === 422) return true
    if (error.chatwootStatus === 401 || error.chatwootStatus === 403) return false
    throw error
  }
}

function safeJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return { message: text.slice(0, 200) }
  }
}

/**
 * O token de administrador da conta é o que destrava tudo que vem depois: criar
 * a inbox pela Evolution e registrar o webhook do agente. Antes ele só era
 * capturado se algum vendedor tivesse papel `administrator` — numa loja com
 * apenas vendedores, ficava vazio e a implantação seguia quebrada em silêncio.
 * Agora criamos um usuário de serviço próprio da loja e guardamos o token dele.
 */
async function ensureAdminToken(accountId, tenant, existingToken) {
  if (existingToken) return existingToken

  const domain = process.env.CHATWOOT_BOT_EMAIL_DOMAIN || 'wissencars.app'

  for (const sufixo of ['', `-${crypto.randomBytes(3).toString('hex')}`]) {
    try {
      const created = await platform('users', {
        method: 'POST',
        body: {
          name: `Wissen Cars (${tenant.nome})`,
          email: `wissen-bot+${tenant.slug}${sufixo}@${domain}`,
          password: crypto.randomBytes(18).toString('base64url'),
          confirmed: true,
        },
      })

      await platform(`accounts/${accountId}/account_users`, {
        method: 'POST',
        body: { user_id: created.id, role: 'administrator' },
      }).catch((error) => {
        if (error.chatwootStatus !== 422) throw error
      })

      if (created.access_token) return created.access_token
    } catch (error) {
      // 422 = e-mail já usado; tentamos de novo com sufixo aleatório
      if (error.chatwootStatus !== 422) throw error
    }
  }

  throw new HttpError(
    502,
    'Não foi possível gerar o token de administrador da central.',
    'Crie um agente administrador no Chatwoot e informe o token dele.',
  )
}

/**
 * Cria (ou reaproveita) a sub-conta da loja no Chatwoot e garante que cada
 * vendedor cadastrado tenha usuário e acesso à conta.
 */
router.post(
  '/provision',
  route(async (req, res) => {
    const { tenant, settings } = await requireTenant(req)
    const { baseUrl } = chatwootConfig()

    const channel = await db.selectOne('tenant_channels', `tenant_id=eq.${tenant.id}&select=*`)
    const team = await db.select('salespeople', `tenant_id=eq.${tenant.id}&select=*&order=created_at`)

    if (!team.length) {
      throw new HttpError(400, 'Cadastre pelo menos um vendedor antes de criar a central.')
    }

    let accountId = channel?.chatwoot_account_id ?? null
    if (!accountId) {
      const account = await platform('accounts', { method: 'POST', body: { name: tenant.nome } })
      accountId = account.id
    } else if (!(await canManageAccount(accountId))) {
      // Conta criada fora do painel: dá para cadastrar a equipe aqui, mas o
      // convite precisa ser feito no próprio Chatwoot. Não criamos usuários
      // soltos, que ficariam sem conta nenhuma.
      res.json({
        account_id: accountId,
        users: [],
        warning: `A central #${accountId} foi criada fora do painel, então este Platform App não pode adicionar usuários nela. Convide a equipe direto no Chatwoot (Configurações › Agentes) — a lista aqui continua servindo de referência para a IA.`,
      })
      return
    }

    const users = []
    let adminToken = settings?.chatwoot_token ?? null

    for (const person of team) {
      let userId = person.chatwoot_user_id ?? null
      let invited = false
      let accessToken = null

      if (!userId) {
        try {
          const created = await platform('users', {
            method: 'POST',
            body: {
              name: person.name,
              email: person.email,
              password: crypto.randomBytes(18).toString('base64url'),
              confirmed: true,
            },
          })
          userId = created.id
          accessToken = created.access_token ?? null
          invited = true
        } catch (error) {
          // 422 = usuário já existe no Chatwoot (outra loja ou cadastro anterior)
          if (error.status !== 422) throw error
        }
      }

      if (userId) {
        await platform(`accounts/${accountId}/account_users`, {
          method: 'POST',
          body: { user_id: userId, role: person.role },
        }).catch((error) => {
          if (error.status !== 422) throw error // 422 = já pertence à conta
        })

        await db.update('salespeople', `id=eq.${person.id}`, { chatwoot_user_id: userId })
        if (person.role === 'administrator' && accessToken) adminToken = accessToken
      }

      users.push({ email: person.email, chatwoot_user_id: userId, role: person.role, invited })
    }

    adminToken = await ensureAdminToken(accountId, tenant, adminToken)

    await upsertChannel(tenant.id, { chatwoot_account_id: accountId, ativo: true })

    // chatwoot_base_url já pode estar apontando para o host interno do Docker
    // (ex.: http://wissen_chatwoot:3000), que é o endereço certo para o n8n e a
    // Evolution usarem. Só preenchemos quando ainda está vazio.
    // Gravamos ANTES de registrar o webhook: se o webhook falhar, o token já
    // está salvo e a etapa pode ser repetida sem criar outro usuário.
    const settingsPatch = { tenant_id: tenant.id }
    if (!settings?.chatwoot_base_url) settingsPatch.chatwoot_base_url = baseUrl
    if (adminToken) settingsPatch.chatwoot_token = adminToken

    if (Object.keys(settingsPatch).length > 1) {
      await db.upsert('tenant_settings', [settingsPatch], 'tenant_id')
    }

    // Sem este webhook o Chatwoot nunca avisa o n8n e a IA não responde.
    const webhook = await ensureAgentWebhook(accountId, adminToken)

    res.json({ account_id: accountId, users, webhook })
  }),
)

export default router
