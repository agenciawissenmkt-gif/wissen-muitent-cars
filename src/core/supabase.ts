import { createClient } from '@supabase/supabase-js'
import { demoCliente, isDemo } from '../demo/demo'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** Sem as variáveis de ambiente o app mostra a tela de configuração em vez de quebrar. */
export const isSupabaseConfigured = Boolean(url && anonKey)

const real = createClient(url || 'https://placeholder.supabase.co', anonKey || 'placeholder-anon-key', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

/**
 * Na demonstração do painel (botão no login) as telas falam com um banco de
 * mentira na memória da aba (src/demo/fakeSupabase.ts) em vez do Supabase.
 * `auth` continua sendo o de verdade -- e na demonstração não há sessão, então
 * nem uma chamada que escapasse conseguiria ler ou gravar nada (RLS).
 */
export const supabase = new Proxy(real, {
  get(alvo, prop) {
    const falso = isDemo() && prop !== 'auth' ? demoCliente() : null
    const origem = (falso ?? alvo) as unknown as Record<PropertyKey, unknown>
    const valor = Reflect.get(origem, prop)
    return typeof valor === 'function' ? (valor as (...a: unknown[]) => unknown).bind(origem) : valor
  },
})

export const CAR_PHOTOS_BUCKET = 'car-photos'
/** PDF do laudo cautelar de cada carro (público, só PDF, até 10 MB). */
export const CAR_LAUDOS_BUCKET = 'car-laudos'
