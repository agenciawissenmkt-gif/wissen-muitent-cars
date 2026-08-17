import { Router } from 'express'
import { db, HttpError } from '../lib/db.js'
import { requireTenant, route } from '../lib/auth.js'

const router = Router()

/**
 * Fecha a implementação: monta o payload da loja e entrega ao webhook do N8N,
 * que cria/atualiza o fluxo do agente autônomo para esse tenant.
 */
router.post(
  '/complete',
  route(async (req, res) => {
    const { user, store, tenant, settings } = await requireTenant(req)

    const [channel, google, team, agents] = await Promise.all([
      db.selectOne('tenant_channels', `tenant_id=eq.${tenant.id}&select=*`),
      db.selectOne('tenant_google_credentials', `tenant_id=eq.${tenant.id}&select=calendar_id,email`),
      db.select('salespeople', `tenant_id=eq.${tenant.id}&select=name,email,role&order=created_at`),
      db.select('tenant_agents', `tenant_id=eq.${tenant.id}&select=agent_type,system_prompt`),
    ])

    const prompt = (type) => agents?.find((agent) => agent.agent_type === type)?.system_prompt ?? ''

    const payload = {
      store_name: store.name,
      owner_email: user.email,
      bot_phone: settings?.bot_phone ?? channel?.whatsapp_number ?? null,
      google_calendar_id: google?.calendar_id ?? settings?.google_calendar_id ?? 'primary',
      prompt_descoberta: prompt('descoberta'),
      prompt_encantamento: prompt('encantamento'),
      prompt_fechamento: prompt('fechamento'),
      salespeople: (team ?? []).map((person) => ({
        name: person.name,
        email: person.email,
        role: person.role,
      })),
      // Contexto extra para o fluxo localizar a loja e respeitar suas regras
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        nome: tenant.nome,
        timezone: tenant.timezone,
        store_id: store.id,
        cnpj: store.cnpj,
        contact_phone: store.phone,
        chatwoot_base_url: settings?.chatwoot_base_url ?? null,
        account_id: channel?.chatwoot_account_id ?? null,
        inbox_id: channel?.chatwoot_inbox_id ?? null,
        instance_name: channel?.evolution_instance ?? null,
      },
      regras: {
        aceita_consignacao: store.offers_consignment,
        aceita_troca: store.accepts_trade,
        carro_de_leilao: store.works_with_auction,
        laudo_cautelar: store.has_inspection ? store.inspection_type : null,
        bancos_parceiros: store.partner_banks ?? [],
        garantia_meses: store.warranty_months,
        formas_pagamento: store.payment_methods ?? [],
        test_drive: store.offers_test_drive,
        entrega: store.offers_delivery,
      },
      horario_ia: settings?.horario_atendimento ?? '24h',
      endereco: [store.address_street, store.address_number, store.address_district, store.address_city, store.address_state]
        .filter(Boolean)
        .join(', '),
    }

    const webhook = process.env.N8N_PROVISIONING_WEBHOOK_URL
    if (!webhook) {
      res.json({ ok: true, forwarded: false, payload })
      return
    }

    const response = await fetch(webhook, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.N8N_WEBHOOK_TOKEN ? { Authorization: `Bearer ${process.env.N8N_WEBHOOK_TOKEN}` } : {}),
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 200)
      throw new HttpError(502, `O webhook do N8N respondeu ${response.status}. ${detail}`)
    }

    res.json({ ok: true, forwarded: true, payload })
  }),
)

export default router
