/**
 * Tipos espelhados do schema real do projeto Supabase (wissen-cars-multitenant).
 *
 * O modelo tem dois lados:
 *   - `stores`  — a loja do dono, ligada ao usuário do Google por `owner_id`;
 *   - `tenants` — o lado consumido pelo agente no N8N, ligado à loja por `stores.tenant_id`.
 * Veículos, fotos, configurações e prompts penduram no `tenant_id`.
 */

export type CarStatus = 'ativo' | 'reservado' | 'vendido'

export type OnboardingStep = 'perfil' | 'chatwoot' | 'calendar' | 'evolution' | 'concluido'

export type InspectionType = 'nenhum' | 'pesquisa' | 'completo'

export type AgentType = 'descoberta' | 'encantamento' | 'fechamento'

export type SalespersonRole = 'administrator' | 'agent'

export interface Store {
  id: string
  owner_id: string
  tenant_id: string | null
  slug: string | null
  name: string
  legal_name: string | null
  cnpj: string | null
  phone: string | null
  whatsapp: string | null
  email: string | null
  website: string | null
  instagram: string | null
  logo_url: string | null
  address_street: string | null
  address_number: string | null
  address_complement: string | null
  address_district: string | null
  address_city: string | null
  address_state: string | null
  address_zip: string | null
  maps_url: string | null
  has_inspection: boolean
  inspection_type: InspectionType
  warranty_months: number
  warranty_details: string | null
  vehicle_conditions: string[]
  vehicle_categories: string[]
  accepts_trade: boolean
  offers_financing: boolean
  offers_consignment: boolean
  offers_test_drive: boolean
  offers_delivery: boolean
  offers_documentation: boolean
  works_with_auction: boolean
  partner_banks: string[]
  payment_methods: string[]
  differentials: string | null
  service_notes: string | null
  /** A semana da loja. Use `normalizaHorario` de `core/business-hours` para ler. */
  business_hours: unknown
  /** A mesma semana em português, pronta para o prompt e para a base de conhecimento. */
  business_hours_text: string | null
  timezone: string
  /** Quando o lojista confirmou o checklist de risco do número, na etapa do WhatsApp. */
  whatsapp_checklist_em: string | null
  onboarding_step: OnboardingStep
  created_at: string
}

export interface Tenant {
  id: string
  nome: string
  slug: string
  ativo: boolean
  timezone: string
}

export interface TenantSettings {
  tenant_id: string
  chatwoot_base_url: string | null
  chatwoot_token: string | null
  evolution_base_url: string | null
  evolution_instance: string | null
  bot_phone: string | null
  google_calendar_id: string | null
  horario_atendimento: string | null
  endereco_loja: string | null
  followup_ativo: boolean
  team_atendimento_id: number | null
  team_descoberta_id: number | null
  team_fechamento_id: number | null
  team_encantamento_id: number | null
  extra: Record<string, unknown>
}

export interface TenantChannel {
  id: string
  tenant_id: string
  chatwoot_account_id: number | null
  chatwoot_inbox_id: number | null
  evolution_instance: string | null
  whatsapp_number: string | null
  ativo: boolean
}

export interface AgentPrompt {
  id: string
  tenant_id: string
  agent_type: AgentType
  nome_agente: string
  model: string
  temperature: number
  system_prompt: string
  ativo: boolean
}

export interface GoogleCredentials {
  tenant_id: string
  email: string | null
  calendar_id: string
  expires_at: string | null
}

export interface Salesperson {
  id: string
  tenant_id: string
  name: string
  email: string
  role: SalespersonRole
  chatwoot_user_id: number | null
}

export interface CarPhoto {
  id: string
  tenant_id: string
  car_id: string
  url: string
  ordem: number
  is_cover: boolean
  storage_path: string | null
}

export interface Car {
  id: string
  tenant_id: string
  store_id: string | null
  external_id: string | null
  brand: string | null
  model: string
  version: string | null
  year: number | null
  model_year: number | null
  color: string | null
  doors: number | null
  transmission: string | null
  body_type: string | null
  fuel: string | null
  mileage_km: number | null
  price_brl: number | null
  engine: string | null
  cylinders: string | null
  horsepower: string | null
  torque: string | null
  acceleration_0_100: string | null
  aspiration: string | null
  traction: string | null
  air_conditioning: string | null
  steering: string | null
  electric_windows: string | null
  ipva_paid: boolean | null
  licensed: boolean | null
  single_owner: boolean | null
  dealer_revisions: boolean | null
  accepts_trade: boolean | null
  description: string | null
  cover_url: string | null
  status: CarStatus
  created_at: string
  car_photos: CarPhoto[]
}

export const CAR_STATUS_LABEL: Record<CarStatus, string> = {
  ativo: 'Disponível',
  reservado: 'Reservado',
  vendido: 'Vendido',
}

export const AGENT_LABEL: Record<AgentType, string> = {
  descoberta: 'Descoberta',
  encantamento: 'Encantamento',
  fechamento: 'Fechamento',
}

export const AGENT_HINT: Record<AgentType, string> = {
  descoberta: 'Como a IA entende a necessidade do cliente.',
  encantamento: 'Como a IA apresenta o veículo e envia as fotos.',
  fechamento: 'Como a IA conduz para a visita, o test-drive e o financiamento.',
}

export const INSPECTION_LABEL: Record<InspectionType, string> = {
  nenhum: 'Não trabalhamos com laudo',
  pesquisa: 'Pesquisa veicular',
  completo: 'Laudo cautelar completo',
}

/** Ordem das etapas na tela × valor gravado em stores.onboarding_step. */
export const STEP_TO_ONBOARDING: Record<number, OnboardingStep> = {
  1: 'perfil',
  2: 'calendar',
  3: 'chatwoot',
  4: 'evolution',
}

export const ONBOARDING_TO_STEP: Record<OnboardingStep, number> = {
  perfil: 1,
  calendar: 2,
  chatwoot: 3,
  evolution: 4,
  concluido: 4,
}

export const TRANSMISSIONS = ['Manual', 'Automático', 'Automatizado', 'CVT'] as const
export const FUELS = ['Flex', 'Gasolina', 'Etanol', 'Diesel', 'Híbrido', 'Elétrico', 'GNV'] as const
export const BODY_TYPES = ['Hatch', 'Sedã', 'SUV', 'Picape', 'Utilitário', 'Coupé', 'Conversível', 'Minivan'] as const
export const TRACTIONS = ['Dianteira', 'Traseira', '4x4', 'AWD'] as const
export const PARTNER_BANKS = ['BV', 'Santander', 'Itaú', 'Bradesco', 'Pan'] as const
