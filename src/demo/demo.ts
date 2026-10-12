/**
 * Estado da demonstracao do painel (botao "Demonstração do painel" no login).
 *
 * A demonstracao nao tem login nem sessao no Supabase. Ao entrar, o servidor
 * devolve uma copia (so leitura) da loja modelo e um passe assinado que vale
 * algumas horas e so serve para a IA da demonstracao (ficha e laudo). A partir
 * dai o painel roda contra o banco de mentira (fakeSupabase.ts), na memoria da
 * aba. Recarregar a pagina recomeca a demonstracao do zero.
 */
import type { User, Session } from '@supabase/supabase-js'
import { criarSupabaseFalso, type FakeDb } from './fakeSupabase'

const CHAVE_SESSAO = 'wissen-demo'

export const DEMO_TENANT = 'demo-tenant'
export const DEMO_STORE = 'demo-store'
export const DEMO_USER = 'demo-user'

interface CopiaDaLoja {
  passe: string
  expira_em: string
  loja: Record<string, unknown>
  tenant: { nome: string; timezone: string }
  settings: Record<string, unknown>
  carros: (Record<string, unknown> & { id: string; fotos: { url: string; ordem: number; is_cover: boolean }[] })[]
}

let ativa = false
let passe: string | null = null
let cliente: ReturnType<typeof criarSupabaseFalso> | null = null

function lerSessao() {
  try {
    return window.sessionStorage.getItem(CHAVE_SESSAO) === '1'
  } catch {
    return false
  }
}

function gravarSessao(valor: boolean) {
  try {
    if (valor) window.sessionStorage.setItem(CHAVE_SESSAO, '1')
    else window.sessionStorage.removeItem(CHAVE_SESSAO)
  } catch {
    // Sem storage (aba privada): a demonstracao so nao sobrevive ao recarregar.
  }
}

/** A aba pediu a demonstracao (agora ou antes de recarregar a pagina)? */
export function demoPedida(): boolean {
  return ativa || lerSessao()
}

/** O painel ja esta rodando contra o banco da demonstracao? */
export function isDemo(): boolean {
  return ativa
}

export function demoCliente() {
  return cliente
}

export function demoPasse(): string | null {
  return passe
}

export const DEMO_USUARIO = {
  id: DEMO_USER,
  aud: 'authenticated',
  role: 'authenticated',
  email: 'demonstracao@wissencars.com.br',
  app_metadata: {},
  user_metadata: { full_name: 'Demonstração Wissen Cars' },
  created_at: new Date(0).toISOString(),
} as unknown as User

export const DEMO_SESSAO = {
  access_token: '',
  refresh_token: '',
  token_type: 'bearer',
  expires_in: 0,
  user: DEMO_USUARIO,
} as unknown as Session

/** Busca a copia da loja modelo e liga o banco de mentira. */
export async function iniciarDemo(): Promise<void> {
  let res: Response
  try {
    res = await fetch('/api/demo/iniciar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  } catch {
    gravarSessao(false)
    throw new Error('Sem conexão. Confira a internet e tente de novo.')
  }
  const corpo = (await res.json().catch(() => null)) as (CopiaDaLoja & { error?: string }) | null
  if (!res.ok || !corpo?.passe) {
    gravarSessao(false)
    throw new Error(corpo?.error || 'Não foi possível abrir a demonstração agora.')
  }

  cliente = criarSupabaseFalso(montarBanco(corpo))
  passe = corpo.passe
  ativa = true
  gravarSessao(true)
}

export function sairDemo() {
  ativa = false
  passe = null
  cliente = null
  gravarSessao(false)
  window.location.replace('/')
}

function montarBanco(copia: CopiaDaLoja): FakeDb {
  const agora = new Date().toISOString()
  const fotos: Record<string, unknown>[] = []

  const carros = copia.carros.map((carro) => {
    const { fotos: lista, ...resto } = carro
    for (const foto of lista) {
      fotos.push({
        id: crypto.randomUUID(),
        tenant_id: DEMO_TENANT,
        car_id: carro.id,
        url: foto.url,
        ordem: foto.ordem,
        is_cover: foto.is_cover,
        storage_path: null,
      })
    }
    return {
      ...resto,
      tenant_id: DEMO_TENANT,
      store_id: DEMO_STORE,
      laudo_pdf_path: null,
      sold_at: null,
      reserva_solicitada_em: null,
      reserva_expira_em: null,
      reserva_cliente: null,
      reserva_telefone: null,
      reserva_conversa_url: null,
      reserva_obs: null,
    }
  })

  const loja = {
    ...copia.loja,
    id: DEMO_STORE,
    owner_id: DEMO_USER,
    tenant_id: DEMO_TENANT,
    // A implementacao abre na etapa 1, ja preenchida, para mostrar todas as etapas.
    onboarding_step: 'perfil',
    profile_completed_at: null,
    whatsapp_checklist_em: null,
    created_at: agora,
    updated_at: agora,
  }

  const umDia = 86400_000
  const ha = (dias: number) => new Date(Date.now() - dias * umDia).toISOString()

  return {
    stores: [loja],
    tenants: [{ id: DEMO_TENANT, slug: 'demonstracao', nome: copia.tenant.nome, ativo: true, timezone: copia.tenant.timezone, created_at: agora }],
    tenant_settings: [
      {
        tenant_id: DEMO_TENANT,
        horario_atendimento: copia.settings.horario_atendimento ?? '24h',
        ai_hours: copia.settings.ai_hours ?? null,
        bot_phone: null,
        google_calendar_id: null,
        followup_ativo: true,
        extra: {},
      },
    ],
    tenant_channels: [],
    // Os agentes existem no painel real (um por etapa da conversa); aqui so o nome aparece.
    tenant_agents: ['descoberta', 'encantamento', 'fechamento'].map((tipo) => ({
      id: crypto.randomUUID(),
      tenant_id: DEMO_TENANT,
      agent_type: tipo,
      nome_agente: 'Julia',
      system_prompt: 'Demonstração: o prompt da Julia é montado com os dados da loja.',
      created_at: agora,
      updated_at: agora,
    })),
    tenant_google_credentials: [],
    store_access_blocks: [],
    salespeople: [
      {
        id: crypto.randomUUID(),
        tenant_id: DEMO_TENANT,
        name: 'Gerente da loja (exemplo)',
        email: 'gerente@exemplo.com.br',
        role: 'administrator',
        chatwoot_user_id: null,
        telefone: '41999990001',
        created_at: ha(30),
      },
      {
        id: crypto.randomUUID(),
        tenant_id: DEMO_TENANT,
        name: 'Vendedor (exemplo)',
        email: 'vendedor@exemplo.com.br',
        role: 'agent',
        chatwoot_user_id: null,
        telefone: '41999990002',
        created_at: ha(29),
      },
    ],
    cars: carros,
    car_photos: fotos,
    car_offers: [
      {
        id: crypto.randomUUID(),
        tenant_id: DEMO_TENANT,
        tipo: 'venda',
        status: 'novo',
        cliente_nome: 'Cliente exemplo 1',
        cliente_telefone: '41900000001',
        conversa_url: null,
        marca: 'Volkswagen',
        modelo: 'Gol',
        versao: '1.0 MPI',
        ano: 2018,
        km: 78000,
        cor: 'Prata',
        estado: 'Bom estado, revisões em dia',
        quitado: true,
        financiamento_detalhes: null,
        historico: 'Único dono',
        documentacao: 'Em dia',
        preco_pedido: 42000,
        cidade: 'Curitiba',
        urgencia: 'Quer trocar este mês',
        observacoes: 'Quer vender para dar entrada em um SUV.',
        fotos: [],
        created_at: ha(1),
        updated_at: ha(1),
      },
      {
        id: crypto.randomUUID(),
        tenant_id: DEMO_TENANT,
        tipo: 'consignacao',
        status: 'em_avaliacao',
        cliente_nome: 'Cliente exemplo 2',
        cliente_telefone: '41900000002',
        conversa_url: null,
        marca: 'Honda',
        modelo: 'Civic',
        versao: 'EXL 2.0',
        ano: 2019,
        km: 61000,
        cor: 'Preto',
        estado: 'Ótimo estado',
        quitado: false,
        financiamento_detalhes: 'Faltam 12 parcelas',
        historico: 'Sem sinistro',
        documentacao: 'Em dia',
        preco_pedido: 105000,
        cidade: 'São José dos Pinhais',
        urgencia: null,
        observacoes: null,
        fotos: [],
        created_at: ha(3),
        updated_at: ha(2),
      },
    ],
    report_settings: [],
    store_reports: [],
    monitor_lojas: [],
    monitor_eventos: [],
  }
}
