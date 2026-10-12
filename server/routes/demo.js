// Demonstracao do painel: o botao "Demonstração do painel" da tela de login.
//
// Serve para o vendedor da Wissen mostrar o painel na loja do cliente sem
// login. A regra de seguranca e simples: a demonstracao NAO TEM sessao no
// Supabase e NAO GRAVA NADA. O navegador recebe uma copia (so leitura) dos
// dados da loja modelo e trabalha com ela em memoria (src/demo/). Daqui so
// saem tres coisas:
//
//   POST /api/demo/iniciar  -> copia da loja modelo + um passe assinado (4 h)
//   POST /api/demo/ficha    -> "Gerar ficha com IA" (passe obrigatorio)
//   POST /api/demo/laudo    -> leitura do PDF do laudo (passe obrigatorio)
//
// Nada de Google, WhatsApp, Chatwoot, n8n ou storage: essas rotas nem existem
// aqui. A IA tem teto por passe, por IP e por dia (somando todas as demos), e
// o consumo entra em ai_usage como demo_ficha / demo_laudo.

import { createHmac, createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import express, { Router } from 'express'
import { db, HttpError } from '../lib/db.js'
import { route } from '../lib/auth.js'
import { gerarFicha } from './ficha.js'
import { lerLaudoPdf } from './laudo.js'

const router = Router()

// Laudo vem como PDF em base64 (ate 3 MB de arquivo). A Vercel aceita 4,5 MB de corpo.
router.use(express.json({ limit: '4400kb' }))

/** Loja modelo cujos dados aparecem na demonstracao (a Autocar, por padrao). */
const LOJA_MODELO = process.env.DEMO_TENANT_ID || '8c7e053a-8ca8-4ff0-a402-70b536d415c7'

const PASSE_HORAS = 4
const MAX_FICHAS_POR_PASSE = Number(process.env.DEMO_MAX_FICHAS_POR_PASSE || 25)
const MAX_LAUDOS_POR_PASSE = Number(process.env.DEMO_MAX_LAUDOS_POR_PASSE || 10)
const MAX_IA_POR_DIA = Number(process.env.DEMO_MAX_IA_POR_DIA || 300)
const MAX_INICIOS_POR_IP_HORA = Number(process.env.DEMO_MAX_INICIOS_POR_HORA || 40)
const MAX_IA_POR_IP_HORA = Number(process.env.DEMO_MAX_IA_POR_IP_HORA || 40)
const PDF_MAX_BYTES = 3 * 1024 * 1024

// --- passe assinado -----------------------------------------------------------

function segredo() {
  const base = process.env.DEMO_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base) throw new HttpError(503, 'Demonstração indisponível no momento.')
  // Deriva uma chave so para isto: o passe nunca carrega nada da service key.
  return createHash('sha256').update(`wissen-demo-v1:${base}`).digest()
}

const b64url = (buf) => Buffer.from(buf).toString('base64url')

function emitirPasse() {
  const dados = { id: randomUUID(), exp: Date.now() + PASSE_HORAS * 3600_000 }
  const corpo = b64url(JSON.stringify(dados))
  const assinatura = b64url(createHmac('sha256', segredo()).update(corpo).digest())
  return { passe: `${corpo}.${assinatura}`, expira_em: new Date(dados.exp).toISOString(), id: dados.id }
}

function conferirPasse(req) {
  const passe = String(req.headers['x-demo-passe'] || '')
  const [corpo, assinatura] = passe.split('.')
  if (!corpo || !assinatura || passe.length > 400) throw new HttpError(401, 'Demonstração expirada. Entre de novo.')
  const esperada = createHmac('sha256', segredo()).update(corpo).digest()
  const recebida = Buffer.from(assinatura, 'base64url')
  if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada)) {
    throw new HttpError(401, 'Demonstração expirada. Entre de novo.')
  }
  let dados
  try {
    dados = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8'))
  } catch {
    throw new HttpError(401, 'Demonstração expirada. Entre de novo.')
  }
  if (!dados?.id || !(Number(dados.exp) > Date.now())) throw new HttpError(401, 'Demonstração expirada. Entre de novo.')
  return dados.id
}

// --- limites em memoria (por instancia; o teto diario no banco vale para todas) --

const contadores = new Map()

function contar(chave, maximo, janelaMs) {
  const agora = Date.now()
  const atual = contadores.get(chave)
  if (!atual || atual.ate < agora) {
    contadores.set(chave, { n: 1, ate: agora + janelaMs })
  } else {
    atual.n += 1
    if (atual.n > maximo) return false
  }
  if (contadores.size > 5000) {
    for (const [k, v] of contadores) if (v.ate < agora) contadores.delete(k)
  }
  return true
}

function ipDe(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  return fwd || req.socket?.remoteAddress || 'sem-ip'
}

/** Teto do dia somando todas as demonstracoes. Se o banco nao responder, a IA fica fechada. */
async function dentroDoTetoDiario() {
  const desde = new Date(Date.now() - 86400_000).toISOString()
  try {
    const linhas = await db.select(
      'ai_usage',
      `select=id&agent_type=in.(demo_ficha,demo_laudo)&occurred_at=gte.${encodeURIComponent(desde)}&limit=${MAX_IA_POR_DIA + 1}`,
    )
    return (linhas?.length || 0) < MAX_IA_POR_DIA
  } catch (erro) {
    console.error('[demo] teto diario indisponivel:', erro?.message || erro)
    return false
  }
}

async function liberarIa(req, tipo) {
  const passeId = conferirPasse(req)
  const maxPasse = tipo === 'ficha' ? MAX_FICHAS_POR_PASSE : MAX_LAUDOS_POR_PASSE
  if (!contar(`passe:${tipo}:${passeId}`, maxPasse, PASSE_HORAS * 3600_000)) {
    throw new HttpError(429, 'Limite de uso da IA nesta demonstração atingido.')
  }
  if (!contar(`ia:${ipDe(req)}`, MAX_IA_POR_IP_HORA, 3600_000)) {
    throw new HttpError(429, 'Muitos pedidos seguidos. Espere alguns minutos.')
  }
  if (!(await dentroDoTetoDiario())) {
    throw new HttpError(429, 'A IA da demonstração atingiu o limite de hoje. Tente amanhã.')
  }
}

// --- copia da loja modelo ------------------------------------------------------

// So o que a tela mostra. Nada de dono, token, canal, instancia ou agenda.
const CAMPOS_LOJA = [
  'slug', 'name', 'legal_name', 'cnpj', 'phone', 'whatsapp', 'email', 'website', 'instagram', 'logo_url',
  'address_street', 'address_number', 'address_complement', 'address_district', 'address_city', 'address_state',
  'address_zip', 'maps_url', 'has_inspection', 'inspection_type', 'warranty_months', 'warranty_details',
  'vehicle_conditions', 'vehicle_categories', 'accepts_trade', 'offers_financing', 'offers_consignment',
  'offers_test_drive', 'offers_delivery', 'offers_documentation', 'payment_methods', 'differentials',
  'service_notes', 'business_hours', 'timezone', 'works_with_auction', 'partner_banks', 'business_hours_text',
  'delivery_details', 'documentation_details', 'accepts_own_inspection', 'discount_policy', 'consortium_details',
  'buys_cars', 'purchase_details', 'consignment_terms', 'intake_rules',
]

const CAMPOS_CARRO = [
  'id', 'external_id', 'brand', 'model', 'version', 'year', 'color', 'doors', 'transmission', 'body_type', 'fuel',
  'mileage_km', 'price_brl', 'engine', 'cylinders', 'horsepower', 'torque', 'acceleration_0_100', 'aspiration',
  'traction', 'air_conditioning', 'steering', 'electric_windows', 'ipva_paid', 'licensed', 'single_owner',
  'dealer_revisions', 'accepts_trade', 'description', 'cover_url', 'status', 'created_at', 'updated_at',
  'model_year', 'sunroof', 'carplay_android_auto', 'trunk_liters', 'leather_seats', 'keyless_entry',
  'parking_sensor', 'rear_camera', 'laudo_resultado', 'laudo_empresa', 'laudo_data', 'laudo_obs',
  'laudo_pdf_url', 'consumo_cidade', 'consumo_estrada', 'nivel_consumo',
]

let copiaEmCache = null

async function copiaDaLojaModelo() {
  if (copiaEmCache && copiaEmCache.ate > Date.now()) return copiaEmCache.dados

  const [loja, tenant, settings, carros, fotos] = await Promise.all([
    db.selectOne('stores', `tenant_id=eq.${LOJA_MODELO}&select=${CAMPOS_LOJA.join(',')}`),
    db.selectOne('tenants', `id=eq.${LOJA_MODELO}&select=nome,timezone`),
    db.selectOne('tenant_settings', `tenant_id=eq.${LOJA_MODELO}&select=horario_atendimento,ai_hours`),
    db.select('cars', `tenant_id=eq.${LOJA_MODELO}&status=in.(ativo,reservado)&select=${CAMPOS_CARRO.join(',')}&order=created_at.desc&limit=300`),
    db.select('car_photos', `tenant_id=eq.${LOJA_MODELO}&select=car_id,url,ordem,is_cover&limit=3000`),
  ])
  if (!loja) throw new HttpError(503, 'Demonstração indisponível no momento.')

  const porCarro = new Map()
  for (const foto of fotos || []) {
    if (!porCarro.has(foto.car_id)) porCarro.set(foto.car_id, [])
    porCarro.get(foto.car_id).push({ url: foto.url, ordem: foto.ordem, is_cover: foto.is_cover })
  }

  const dados = {
    loja,
    tenant: { nome: tenant?.nome || loja.name, timezone: tenant?.timezone || 'America/Sao_Paulo' },
    settings: settings || {},
    carros: (carros || []).map((carro) => ({ ...carro, fotos: porCarro.get(carro.id) || [] })),
  }
  copiaEmCache = { dados, ate: Date.now() + 60_000 }
  return dados
}

// --- rotas ---------------------------------------------------------------------

router.post(
  '/iniciar',
  route(async (req, res) => {
    if (!contar(`inicio:${ipDe(req)}`, MAX_INICIOS_POR_IP_HORA, 3600_000)) {
      throw new HttpError(429, 'Muitas demonstrações abertas daqui. Espere alguns minutos.')
    }
    const passe = emitirPasse()
    const copia = await copiaDaLojaModelo()
    res.set('Cache-Control', 'no-store')
    res.json({ passe: passe.passe, expira_em: passe.expira_em, ...copia })
  }),
)

const texto = (valor, max) => {
  const t = String(valor ?? '').replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, max) : ''
}

router.post(
  '/ficha',
  route(async (req, res) => {
    const brand = texto(req.body?.brand, 40)
    const model = texto(req.body?.model, 60)
    const version = texto(req.body?.version, 80)
    const anoBruto = Number(req.body?.model_year || req.body?.year)
    const ano = anoBruto >= 1900 && anoBruto <= 2100 ? anoBruto : undefined
    if (!brand || !model) throw new HttpError(400, 'Informe ao menos marca e modelo.')
    await liberarIa(req, 'ficha')
    res.json(await gerarFicha({ brand, model, version, ano }, { tenantId: LOJA_MODELO, agentType: 'demo_ficha' }))
  }),
)

router.post(
  '/laudo',
  route(async (req, res) => {
    const base64 = String(req.body?.pdf_base64 || '').replace(/^data:application\/pdf;base64,/, '')
    if (!base64 || !/^[A-Za-z0-9+/=\s]+$/.test(base64)) throw new HttpError(400, 'Envie o PDF do laudo.')
    const pdf = Buffer.from(base64, 'base64')
    if (pdf.length > PDF_MAX_BYTES) throw new HttpError(413, 'Na demonstração o PDF pode ter até 3 MB.')
    if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new HttpError(400, 'Esse arquivo não é um PDF.')
    await liberarIa(req, 'laudo')
    res.json(
      await lerLaudoPdf(
        { type: 'input_file', filename: 'laudo.pdf', file_data: `data:application/pdf;base64,${pdf.toString('base64')}` },
        { tenantId: LOJA_MODELO, agentType: 'demo_laudo' },
      ),
    )
  }),
)

router.use((_req, res) => {
  res.status(404).json({ error: 'Rota não encontrada.' })
})

export default router
