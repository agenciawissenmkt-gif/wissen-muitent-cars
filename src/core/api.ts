import { supabase } from './supabase'
import { isDemo } from '../demo/demo'
import { demoRequest } from '../demo/demoApi'

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
  // Demonstração do painel: ficha e laudo pela IA de verdade; Google, WhatsApp e
  // central de atendimento desligados (src/demo/demoApi.ts).
  if (isDemo()) {
    try {
      return await demoRequest<T>(path, init)
    } catch (err) {
      const e = err as { message?: string; status?: number; hint?: string }
      throw new ApiError(e?.message || 'Indisponível na demonstração.', e?.status ?? 403, e?.hint)
    }
  }

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
  users: { email: string; chatwoot_user_id: number | null; role: string; invited: boolean }[]
  /** E-mails que o Chatwoot recusou por já pertencerem a outra conta. */
  conflitos?: { nome: string; email: string; motivo: string }[]
  /** Preenchido quando a central existe mas não pode ser administrada pelo painel. */
  warning?: string
  /** E-mail de acesso à central, uma linha por pessoa da equipe. */
  convites?: { email: string; enviado: boolean; motivo?: string }[]
}

/**
 * `reenviarConvites` força um novo e-mail de acesso para toda a equipe. Sem
 * ele, cada pessoa recebe uma vez só — a etapa 3 provisiona no Continuar e de
 * novo ao concluir a implantação, e ninguém quer o mesmo e-mail duas vezes.
 */
export function provisionChatwoot(tenantId: string, reenviarConvites = false) {
  return request<ChatwootProvisionResult>('/chatwoot/provision', {
    method: 'POST',
    body: JSON.stringify({ tenant_id: tenantId, reenviar_convites: reenviarConvites }),
  })
}

export interface ChatwootAgent {
  id: number | null
  name: string
  email: string
  role: string | null
}

/** Agentes que já existem na central da loja — usado para avisar sobre e-mail repetido. */
export function chatwootTeam(tenantId: string) {
  return request<{ agents: ChatwootAgent[] }>(`/chatwoot/team?tenant_id=${encodeURIComponent(tenantId)}`)
}

/**
 * Link de uso único que entra direto na conta daquela pessoa no Chatwoot.
 * Gerado no servidor com a chave Super Admin — nunca chega ao navegador.
 */
export function chatwootSsoUrl(tenantId: string, salespersonId: string) {
  return request<{ url: string; name: string }>('/chatwoot/sso', {
    method: 'POST',
    body: JSON.stringify({ tenant_id: tenantId, salesperson_id: salespersonId }),
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

export function gerarFichaTecnica(input: {
  tenant_id: string
  brand: string
  model: string
  model_year?: number | string
  version?: string
}) {
  return request<{
    ficha: Record<string, string | number>
    preenchidos: number
    total: number
    faltaram?: string[]
    modelo_usado: string
  }>('/ficha', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

/** Leitura do PDF do laudo: o que a IA achou escrito no documento. */
export type LeituraLaudo = {
  tipo_documento: 'laudo_cautelar' | 'vistoria' | 'consulta_veicular' | 'outro'
  empresa: string | null
  data: string | null
  resultado: 'aprovado' | 'com_apontamento' | 'reprovado' | null
  apontamentos: string | null
}

export function lerLaudo(input: { tenant_id: string; pdf_url: string }) {
  return request<{ leitura: LeituraLaudo; modelo_usado: string }>('/laudo/ler', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

// --- OLX --------------------------------------------------------------------

export interface OlxItem {
  id: number
  nome: string
  certeza?: 'alta' | 'conferir'
}

export interface OlxSugestao {
  marca: OlxItem | null
  modelo: OlxItem | null
  versao: OlxItem | null
  marcas: OlxItem[]
  modelos: OlxItem[]
  versoes: OlxItem[]
}

export function olxAuthUrl(tenantId: string) {
  return request<{ url: string }>(`/olx/auth-url?tenant_id=${encodeURIComponent(tenantId)}`)
}

export function olxDesconectar(tenantId: string) {
  return request<{ ok: true }>('/olx/desconectar', { method: 'POST', body: JSON.stringify({ tenant_id: tenantId }) })
}

export function olxConfigurar(tenantId: string, patch: { telefone_anuncio?: string; publicar_tudo?: boolean }) {
  return request<{ ok: true; telefone_anuncio: string | null; publicar_tudo: boolean }>('/olx/configurar', {
    method: 'POST',
    body: JSON.stringify({ tenant_id: tenantId, ...patch }),
  })
}

export function olxSugerir(
  tenantId: string,
  carro: { brand: string; model: string; version: string; engine: string; transmission: string },
) {
  return request<OlxSugestao>('/olx/sugerir', { method: 'POST', body: JSON.stringify({ tenant_id: tenantId, ...carro }) })
}

export function olxCatalogo(tenantId: string, marca?: number | null, modelo?: number | null) {
  const qs = new URLSearchParams({ tenant_id: tenantId })
  if (marca) qs.set('marca', String(marca))
  if (marca && modelo) qs.set('modelo', String(modelo))
  return request<{ itens: OlxItem[] }>(`/olx/catalogo?${qs.toString()}`)
}

export function olxSincronizar(tenantId: string, carId: string, forcar = false) {
  return request<{ situacao: string; mensagem?: string | null; faltando?: string[] }>('/olx/sincronizar', {
    method: 'POST',
    body: JSON.stringify({ tenant_id: tenantId, car_id: carId, forcar }),
  })
}

export function olxPublicarTudo(tenantId: string) {
  return request<{ enviados: number; incompletos: number; iguais: number; comErro: number; aviso: string | null }>(
    '/olx/publicar-tudo',
    { method: 'POST', body: JSON.stringify({ tenant_id: tenantId }) },
  )
}

export function olxAtualizar(tenantId: string) {
  return request<{ atualizados: number }>('/olx/atualizar', { method: 'POST', body: JSON.stringify({ tenant_id: tenantId }) })
}

// --- Webmotors ----------------------------------------------------------------

export interface WebmotorsItem {
  id: number
  nome: string
  certeza?: 'alta' | 'conferir'
}

export interface WebmotorsModalidade {
  id: number
  nome: string
  tipo: string | null
  total: number
  usados: number
  permiteFoto: boolean
}

export interface WebmotorsSugestao {
  marca: WebmotorsItem | null
  modelo: WebmotorsItem | null
  versao: WebmotorsItem | null
  marcas: WebmotorsItem[]
  modelos: WebmotorsItem[]
  versoes: WebmotorsItem[]
}

export function webmotorsStatus(tenantId: string) {
  return request<{ configurada: boolean; ambiente: 'homologacao' | 'producao' | null }>(
    `/webmotors/status?tenant_id=${encodeURIComponent(tenantId)}`,
  )
}

export function webmotorsConectar(tenantId: string, login: { cnpj: string; email: string; senha: string }) {
  return request<{ ok: true; modalidades: WebmotorsModalidade[] }>('/webmotors/conectar', {
    method: 'POST',
    body: JSON.stringify({ tenant_id: tenantId, ...login }),
  })
}

export function webmotorsDesconectar(tenantId: string) {
  return request<{ ok: true }>('/webmotors/desconectar', { method: 'POST', body: JSON.stringify({ tenant_id: tenantId }) })
}

export function webmotorsModalidades(tenantId: string) {
  return request<{ itens: WebmotorsModalidade[] }>(`/webmotors/modalidades?tenant_id=${encodeURIComponent(tenantId)}`)
}

export function webmotorsConfigurar(tenantId: string, patch: { modalidade_cod?: number; publicar_tudo?: boolean }) {
  return request<{ ok: true; modalidade_cod: number | null; modalidade_nome: string | null; publicar_tudo: boolean }>(
    '/webmotors/configurar',
    { method: 'POST', body: JSON.stringify({ tenant_id: tenantId, ...patch }) },
  )
}

export function webmotorsSugerir(
  tenantId: string,
  carro: { brand: string; model: string; version: string; engine: string; transmission: string; model_year: string },
) {
  return request<WebmotorsSugestao>('/webmotors/sugerir', {
    method: 'POST',
    body: JSON.stringify({ tenant_id: tenantId, ...carro }),
  })
}

export function webmotorsCatalogo(tenantId: string, marca?: number | null, modelo?: number | null, ano?: string | null) {
  const qs = new URLSearchParams({ tenant_id: tenantId })
  if (marca) qs.set('marca', String(marca))
  if (marca && modelo) qs.set('modelo', String(modelo))
  if (marca && modelo && ano) qs.set('ano', ano)
  return request<{ itens: WebmotorsItem[] }>(`/webmotors/catalogo?${qs.toString()}`)
}

export function webmotorsSincronizar(tenantId: string, carId: string, forcar = false) {
  return request<{ situacao: string; mensagem?: string | null; faltando?: string[] }>('/webmotors/sincronizar', {
    method: 'POST',
    body: JSON.stringify({ tenant_id: tenantId, car_id: carId, forcar }),
  })
}

export function webmotorsPublicarTudo(tenantId: string) {
  return request<{
    publicados: number
    incompletos: number
    comErro: number
    emAndamento: number
    restantes: number
    aviso: string | null
  }>('/webmotors/publicar-tudo', { method: 'POST', body: JSON.stringify({ tenant_id: tenantId }) })
}

export function webmotorsAtualizar(tenantId: string) {
  return request<{ atualizados: number }>('/webmotors/atualizar', {
    method: 'POST',
    body: JSON.stringify({ tenant_id: tenantId }),
  })
}
