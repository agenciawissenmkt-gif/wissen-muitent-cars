import { Router } from 'express'
import crypto from 'node:crypto'
import { db, HttpError, upsertChannel } from '../lib/db.js'
import { requireTenant, route } from '../lib/auth.js'
import { ensureAgentWebhook, ensureInboxMembers, listAccountAgents } from '../lib/chatwoot-account.js'

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

/**
 * O painel so consegue criar usuarios em central que ele mesmo criou. Para as
 * criadas por fora, o unico caminho e um token de administrador informado a
 * mao -- e antes de confiar nele precisamos saber se ele realmente abre a API
 * da conta. Bot e usuario sem acesso devolvem 401/403 aqui.
 */
async function tokenEhDeAdmin(baseUrl, accountId, token) {
  if (!token) return false
  try {
    const res = await fetch(baseUrl + '/api/v1/accounts/' + accountId + '/inboxes', {
      headers: { api_access_token: token },
    })
    return res.status !== 401 && res.status !== 403
  } catch {
    return true // rede instavel nao e motivo para travar a etapa
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
      // Central criada fora do painel: o Platform App nao pode criar usuarios
      // nela. Antes isto respondia 200 com um aviso discreto e parava no meio,
      // deixando a loja sem equipe, SEM WEBHOOK e sem token -- e o lojista via
      // o selo verde de central provisionada. O webhook e o que faz a IA
      // receber as mensagens: sem ele nao ha atendimento nenhum. Entao aqui e
      // erro, nao aviso.
      const tokenInformado = settings?.chatwoot_token ?? null

      if (!(await tokenEhDeAdmin(baseUrl, accountId, tokenInformado))) {
        throw new HttpError(
          400,
          'A central #' + accountId + ' foi criada fora do painel e nao pode ser configurada sozinha.',
          'Informe em tenant_settings.chatwoot_token o token de acesso de um administrador dessa central e repita esta etapa. Token de Agent Bot nao serve: o Chatwoot nao deixa bot usar a API da conta.',
        )
      }

      // Com um token valido ainda da para deixar a loja funcionando: registra o
      // webhook e guarda o endereco. So a equipe fica pendente.
      const webhookExterno = await ensureAgentWebhook(accountId, tokenInformado)

      await upsertChannel(tenant.id, { chatwoot_account_id: accountId, ativo: true })

      const patchExterno = { tenant_id: tenant.id }
      if (!settings?.chatwoot_base_url) patchExterno.chatwoot_base_url = baseUrl
      if (Object.keys(patchExterno).length > 1) {
        await db.upsert('tenant_settings', [patchExterno], 'tenant_id')
      }

      res.json({
        account_id: accountId,
        users: [],
        webhook: webhookExterno,
        warning: 'A central #' + accountId + ' foi criada fora do painel: o webhook do agente foi registrado e a IA ja atende, mas a equipe precisa ser convidada direto no Chatwoot em Configuracoes > Agentes.',
      })
      return
    }

    // O administrador (dono da loja) vem primeiro: e o token dele que abre a API
    // da conta para tudo que vem depois. Processar um vendedor antes fazia o
    // painel guardar um token sem permissao de administrador.
    const ordenado = [...team].sort(
      (a, b) => (a.role === 'administrator' ? 0 : 1) - (b.role === 'administrator' ? 0 : 1),
    )

    // Quem ja e agente desta central, por e-mail. Serve para reaproveitar o
    // usuario em vez de tentar cria-lo de novo (e levar 422 a toa).
    const jaNaConta = new Map()
    if (settings?.chatwoot_token) {
      const agentes = await listAccountAgents(accountId, settings.chatwoot_token).catch(() => [])
      for (const agente of agentes) {
        const chave = String(agente?.email || '').toLowerCase()
        if (chave) jaNaConta.set(chave, agente)
      }
    }

    const users = []
    const conflitos = []
    let adminToken = settings?.chatwoot_token ?? null

    for (const person of ordenado) {
      const email = String(person.email || '').toLowerCase()
      let userId = person.chatwoot_user_id ?? jaNaConta.get(email)?.id ?? null
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
          if ((error.chatwootStatus ?? error.status) !== 422) throw error

          // 422 = esse e-mail ja tem conta no Chatwoot e nao e agente desta
          // central (senao teria vindo em jaNaConta). A Platform API nao busca
          // usuario por e-mail, entao nao da para reaproveitar sozinho. Antes o
          // erro era engolido em silencio e a pessoa simplesmente nunca virava
          // agente -- ninguem descobria ate a conversa nao ter para quem ir.
          conflitos.push({
            nome: person.name,
            email: person.email,
            motivo: 'Esse e-mail ja tem conta em outro Chatwoot desta instalacao.',
          })
          users.push({ email: person.email, chatwoot_user_id: null, role: person.role, invited: false })
          continue
        }
      }

      if (userId) {
        await platform(`accounts/${accountId}/account_users`, {
          method: 'POST',
          body: { user_id: userId, role: person.role },
        }).catch((error) => {
          if ((error.chatwootStatus ?? error.status) !== 422) throw error // 422 = já pertence à conta
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

    // E sem isto o vendedor vira agente da conta e mesmo assim nao aparece no
    // seletor "Agente atribuido" da conversa: aquele seletor lista membros da
    // inbox, nao agentes da conta. Na etapa 3 a inbox ainda nao existe (quem a
    // cria e a Evolution, na etapa 4) — por isso esta sincronizacao roda de
    // novo quando a implantacao e concluida, ja com a inbox no lugar.
    const idsDaEquipe = users.map((u) => u.chatwoot_user_id).filter(Boolean)
    const inbox = await ensureInboxMembers(
      accountId,
      adminToken,
      channel?.chatwoot_inbox_id ?? null,
      idsDaEquipe,
    ).catch(() => null)

    res.json({ account_id: accountId, users, conflitos, webhook, inbox })
  }),
)

/**
 * Agentes que ja existem na central da loja. O painel usa isto para avisar,
 * ANTES de cadastrar, que aquele e-mail ja esta em uso — em vez de deixar a
 * pessoa descobrir so na hora da sincronizacao.
 */
router.get(
  '/team',
  route(async (req, res) => {
    const { tenant, settings } = await requireTenant(req)
    const channel = await db.selectOne('tenant_channels', `tenant_id=eq.${tenant.id}&select=*`)
    const accountId = channel?.chatwoot_account_id ?? null

    if (!accountId || !settings?.chatwoot_token) {
      res.json({ agents: [] })
      return
    }

    const agentes = await listAccountAgents(accountId, settings.chatwoot_token).catch(() => [])
    res.json({
      agents: agentes.map((a) => ({
        id: a?.id ?? null,
        name: a?.name ?? '',
        email: String(a?.email || '').toLowerCase(),
        role: a?.role ?? null,
      })),
    })
  }),
)

export default router
