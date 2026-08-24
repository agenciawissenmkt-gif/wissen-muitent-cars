import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'
import type {
  AgentPrompt,
  AgentType,
  GoogleCredentials,
  Salesperson,
  Store,
  Tenant,
  TenantChannel,
  TenantSettings,
} from './types'

interface TenantValue {
  store: Store | null
  tenant: Tenant | null
  settings: TenantSettings | null
  channel: TenantChannel | null
  agents: AgentPrompt[]
  salespeople: Salesperson[]
  google: GoogleCredentials | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  updateStore: (patch: Partial<Store>) => Promise<void>
  updateTenant: (patch: Partial<Tenant>) => Promise<void>
  updateSettings: (patch: Partial<TenantSettings>) => Promise<void>
  updateAgent: (type: AgentType, systemPrompt: string) => Promise<void>
}

const TenantContext = createContext<TenantValue | null>(null)

export function TenantProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [store, setStore] = useState<Store | null>(null)
  const [tenant, setTenant] = useState<Tenant | null>(null)
  const [settings, setSettings] = useState<TenantSettings | null>(null)
  const [channel, setChannel] = useState<TenantChannel | null>(null)
  const [agents, setAgents] = useState<AgentPrompt[]>([])
  const [salespeople, setSalespeople] = useState<Salesperson[]>([])
  const [google, setGoogle] = useState<GoogleCredentials | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  /**
   * Só a PRIMEIRA carga pode ligar `loading`.
   *
   * O AppShell troca a rota inteira por um spinner enquanto `loading` está
   * ligado. Como o refresh() religava essa bandeira, todo salvamento — cadastrar
   * um vendedor, por exemplo — desmontava a tela e a montava de novo: o estado
   * local morria junto, e a Implementação voltava para a etapa gravada em
   * `onboarding_step`. Era isso que jogava o lojista para a etapa 4 a cada
   * vendedor cadastrado, no meio do cadastro.
   *
   * Depois da primeira carga, um refresh() apenas atualiza os dados em silêncio.
   */
  const jaCarregou = useRef(false)

  /**
   * Carrega a loja do usuário logado. Se ela ainda não existe — ou existe sem
   * tenant vinculado — a função bootstrap_store() no banco cria loja, tenant,
   * settings e os três agentes de uma vez só.
   */
  const load = useCallback(async () => {
    if (!user) {
      setStore(null)
      setTenant(null)
      setSettings(null)
      setChannel(null)
      setAgents([])
      setSalespeople([])
      setGoogle(null)
      jaCarregou.current = false
      setLoading(false)
      return
    }

    if (!jaCarregou.current) setLoading(true)
    setError(null)

    try {
      const selectStore = () =>
        supabase.from('stores').select('*').eq('owner_id', user.id).order('created_at').limit(1).maybeSingle()

      let { data: found, error: findError } = await selectStore()
      if (findError) throw findError

      let current = found as Store | null

      if (!current || !current.tenant_id) {
        const fallbackName =
          current?.name || (user.user_metadata?.full_name as string | undefined) || 'Minha Loja'

        const { error: rpcError } = await supabase.rpc('bootstrap_store', { p_nome: fallbackName })
        if (rpcError) throw rpcError

        const retry = await selectStore()
        if (retry.error) throw retry.error
        current = retry.data as Store | null
      }

      if (!current?.tenant_id) throw new Error('Não foi possível vincular a loja a um tenant.')

      const tenantId = current.tenant_id

      const [tenantRes, settingsRes, channelRes, agentsRes, peopleRes, googleRes] = await Promise.all([
        supabase.from('tenants').select('*').eq('id', tenantId).maybeSingle(),
        supabase.from('tenant_settings').select('*').eq('tenant_id', tenantId).maybeSingle(),
        supabase.from('tenant_channels').select('*').eq('tenant_id', tenantId).order('created_at').limit(1).maybeSingle(),
        supabase.from('tenant_agents').select('*').eq('tenant_id', tenantId),
        supabase.from('salespeople').select('*').eq('tenant_id', tenantId).order('created_at'),
        supabase
          .from('tenant_google_credentials')
          .select('tenant_id,email,calendar_id,expires_at')
          .eq('tenant_id', tenantId)
          .maybeSingle(),
      ])

      setStore(current)
      setTenant((tenantRes.data as Tenant | null) ?? null)
      setSettings((settingsRes.data as TenantSettings | null) ?? null)
      setChannel((channelRes.data as TenantChannel | null) ?? null)
      setAgents((agentsRes.data as AgentPrompt[] | null) ?? [])
      setSalespeople((peopleRes.data as Salesperson[] | null) ?? [])
      setGoogle((googleRes.data as GoogleCredentials | null) ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar os dados da loja.')
    } finally {
      jaCarregou.current = true
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void load()
  }, [load])

  const updateStore = useCallback(
    async (patch: Partial<Store>) => {
      if (!store) return
      const { data, error: updateError } = await supabase
        .from('stores')
        .update(patch)
        .eq('id', store.id)
        .select('*')
        .single()
      if (updateError) throw updateError
      setStore(data as Store)
    },
    [store],
  )

  const updateTenant = useCallback(
    async (patch: Partial<Tenant>) => {
      if (!tenant) return
      const { data, error: updateError } = await supabase
        .from('tenants')
        .update(patch)
        .eq('id', tenant.id)
        .select('*')
        .single()
      if (updateError) throw updateError
      setTenant(data as Tenant)
    },
    [tenant],
  )

  const updateSettings = useCallback(
    async (patch: Partial<TenantSettings>) => {
      if (!store?.tenant_id) return
      const { data, error: updateError } = await supabase
        .from('tenant_settings')
        .upsert({ tenant_id: store.tenant_id, ...patch }, { onConflict: 'tenant_id' })
        .select('*')
        .single()
      if (updateError) throw updateError
      setSettings(data as TenantSettings)
    },
    [store],
  )

  const updateAgent = useCallback(
    async (type: AgentType, systemPrompt: string) => {
      if (!store?.tenant_id) return
      const existing = agents.find((agent) => agent.agent_type === type)

      const { data, error: updateError } = existing
        ? await supabase
            .from('tenant_agents')
            .update({ system_prompt: systemPrompt, updated_at: new Date().toISOString() })
            .eq('id', existing.id)
            .select('*')
            .single()
        : await supabase
            .from('tenant_agents')
            .insert({ tenant_id: store.tenant_id, agent_type: type, system_prompt: systemPrompt })
            .select('*')
            .single()

      if (updateError) throw updateError

      const saved = data as AgentPrompt
      setAgents((prev) => {
        const rest = prev.filter((agent) => agent.id !== saved.id)
        return [...rest, saved]
      })
    },
    [store, agents],
  )

  const value = useMemo<TenantValue>(
    () => ({
      store,
      tenant,
      settings,
      channel,
      agents,
      salespeople,
      google,
      loading,
      error,
      refresh: load,
      updateStore,
      updateTenant,
      updateSettings,
      updateAgent,
    }),
    [store, tenant, settings, channel, agents, salespeople, google, loading, error, load, updateStore, updateTenant, updateSettings, updateAgent],
  )

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>
}

export function useTenant(): TenantValue {
  const ctx = useContext(TenantContext)
  if (!ctx) throw new Error('useTenant precisa estar dentro de <TenantProvider>')
  return ctx
}
