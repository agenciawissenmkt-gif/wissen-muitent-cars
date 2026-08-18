import { Router } from 'express'
import { db, HttpError, upsertChannel } from '../lib/db.js'
import { requireTenant, route } from '../lib/auth.js'
import { findInboxByName } from '../lib/chatwoot-account.js'

const router = Router()

/** Modo simulação: permite testar a etapa 4 (QR + comemoração) sem Evolution API. */
const SIMULATE = process.env.WISSEN_SIMULATE === 'true'
const SIMULATED_CONNECT_MS = 12_000
const simulated = new Map()

/** A URL da Evolution pode vir das configurações da loja ou do ambiente. */
function evolutionConfig(settings) {
  const baseUrl = (settings?.evolution_base_url || process.env.EVOLUTION_API_URL || '').replace(/\/$/, '')
  const apiKey = process.env.EVOLUTION_API_KEY

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
    const message = data?.response?.message || data?.message || data?.error || `Erro (${res.status})`
    throw new HttpError(502, `Evolution API: ${Array.isArray(message) ? message.join(', ') : message}`)
  }

  return data
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
    const current = await evolution(config, `instance/connectionState/${name}`).catch(() => null)
    if ((current?.instance?.state ?? current?.state) === 'open') {
      const inboxId = channel?.chatwoot_inbox_id ?? (await findInboxId(settings, tenant, channel?.chatwoot_account_id))
      await upsertChannel(tenant.id, {
        evolution_instance: name,
        whatsapp_number: settings?.bot_phone ?? null,
        chatwoot_account_id: channel?.chatwoot_account_id ?? null,
        ativo: true,
        ...(inboxId ? { chatwoot_inbox_id: inboxId } : {}),
      })
      await db.upsert('tenant_settings', [{ tenant_id: tenant.id, evolution_instance: name }], 'tenant_id')

      res.json({ instance: name, status: 'conectado', qrcode: null, inbox_id: inboxId })
      return
    }

    // Se a instância já existir a Evolution responde erro — seguimos para o connect.
    let created = null
    try {
      created = await evolution(config, 'instance/create', {
        method: 'POST',
        body: {
          instanceName: name,
          qrcode: true,
          integration: 'WHATSAPP-BAILEYS',
          ...(settings?.bot_phone ? { number: settings.bot_phone } : {}),
        },
      })
    } catch (error) {
      if (!/already|exists|in use/i.test(error.message)) throw error
    }

    // Liga a instância à central da loja (cria a inbox no Chatwoot).
    // A URL aqui é a que a Evolution vai usar para falar com o Chatwoot: o host
    // interno do Docker quando existir, senão o endereço público.
    const inboxName = `wissen-${tenant.slug}`
    const chatwootUrlParaEvolution =
      settings?.chatwoot_base_url || process.env.CHATWOOT_INTERNAL_URL || process.env.CHATWOOT_BASE_URL || null

    if (channel?.chatwoot_account_id && chatwootUrlParaEvolution && settings?.chatwoot_token) {
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
    } else if (channel?.chatwoot_account_id && !settings?.chatwoot_token) {
      // Falhar aqui é melhor do que entregar uma loja muda: sem essa ligação as
      // mensagens do WhatsApp nunca chegam ao Chatwoot nem ao agente.
      throw new HttpError(
        400,
        'A central ainda não tem token de administrador.',
        'Refaça a etapa 3 (criar central) para gerar o token antes de conectar o WhatsApp.',
      )
    }

    let qrcode = readQrCode(created)
    if (!qrcode) {
      const connect = await evolution(config, `instance/connect/${name}`)
      qrcode = readQrCode(connect)
    }

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

    const data = await evolution(config, `instance/connectionState/${name}`)
    const rawState = data?.instance?.state ?? data?.state ?? 'close'

    if (rawState === 'open') {
      const inboxId = channel?.chatwoot_inbox_id ?? (await findInboxId(settings, tenant, channel?.chatwoot_account_id))
      await upsertChannel(tenant.id, {
        ativo: true,
        ...(inboxId ? { chatwoot_inbox_id: inboxId } : {}),
      })
      res.json({ instance: name, status: 'conectado', qrcode: null, inbox_id: inboxId })
      return
    }

    const connect = await evolution(config, `instance/connect/${name}`).catch(() => null)
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
