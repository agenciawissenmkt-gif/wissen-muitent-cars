import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../core/supabase'
import { useTenant } from '../../core/tenant'

const REFRESH_INTERVAL = 60_000

type Situacao = 'conectado' | 'instavel' | 'fora_do_ar' | 'sem_instancia' | 'nunca_checado'

interface MonitorRow {
  instancia: string | null
  estado: string | null
  ok: boolean | null
  quedas_seguidas: number | null
  alerta: boolean | null
  desde: string | null
  checado_em: string | null
  recuperacoes: number | null
  situacao: Situacao
}

interface MonitorEvento {
  id: number
  evento: string
  estado: string | null
  criado_em: string
}

const APARENCIA: Record<Situacao, { rotulo: string; ponto: string; caixa: string; texto: string }> = {
  conectado: {
    rotulo: 'WhatsApp conectado',
    ponto: 'bg-emerald-500',
    caixa: 'border-emerald-200 bg-emerald-50',
    texto: 'text-emerald-800',
  },
  instavel: {
    rotulo: 'Conexão oscilando',
    ponto: 'bg-amber-500',
    caixa: 'border-amber-200 bg-amber-50',
    texto: 'text-amber-800',
  },
  fora_do_ar: {
    rotulo: 'WhatsApp fora do ar',
    ponto: 'bg-red-500',
    caixa: 'border-red-200 bg-red-50',
    texto: 'text-red-700',
  },
  sem_instancia: {
    rotulo: 'WhatsApp não conectado',
    ponto: 'bg-red-500',
    caixa: 'border-red-200 bg-red-50',
    texto: 'text-red-700',
  },
  nunca_checado: {
    rotulo: 'Ainda sem leitura',
    ponto: 'bg-ink-300',
    caixa: 'border-ink-100 bg-ink-50',
    texto: 'text-ink-600',
  },
}

const EVENTOS: Record<string, string> = {
  caiu: 'Conexão caiu',
  recuperou: 'Conexão voltou',
  alerta: 'Alerta aberto — fora do ar',
  reconexao_tentada: 'Reconexão automática tentada',
  inicio_ok: 'Primeira leitura — conectado',
  inicio_falha: 'Primeira leitura — sem conexão',
}

/** "há 3 min", "há 2 h", "há 4 dias". */
function haQuantoTempo(iso: string | null): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ms)) return '—'
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'agora há pouco'
  if (min < 60) return `há ${min} min`
  const horas = Math.floor(min / 60)
  if (horas < 24) return `há ${horas} h`
  const dias = Math.floor(horas / 24)
  return dias === 1 ? 'há 1 dia' : `há ${dias} dias`
}

function explicacao(linha: MonitorRow): string {
  switch (linha.situacao) {
    case 'conectado':
      return `Conectado ${haQuantoTempo(linha.desde)} e respondendo aos clientes.`
    case 'instavel':
      return `A Evolution respondeu "${linha.estado ?? 'sem estado'}" nas últimas ${linha.quedas_seguidas ?? 0} verificações. Estamos tentando reconectar sozinhos.`
    case 'fora_do_ar':
      return `Sem conexão ${haQuantoTempo(linha.desde)}. A reconexão automática já foi acionada; se não voltar, refaça a Etapa 4 e leia o QR Code de novo.`
    case 'sem_instancia':
      return 'Não existe conexão ativa para esta loja na Evolution. Vá até a Etapa 4 e conecte o WhatsApp.'
    default:
      return 'O monitor ainda não fez a primeira leitura desta loja. Ele roda a cada 5 minutos.'
  }
}

export function ConnectionStatus() {
  const { store } = useTenant()
  const tenantId = store?.tenant_id ?? null

  const [linha, setLinha] = useState<MonitorRow | null>(null)
  const [eventos, setEventos] = useState<MonitorEvento[]>([])
  const [carregando, setCarregando] = useState(true)
  const [aberto, setAberto] = useState(false)

  const carregar = useCallback(async () => {
    if (!tenantId) return

    const [estado, historico] = await Promise.all([
      supabase
        .from('monitor_lojas')
        .select('instancia, estado, ok, quedas_seguidas, alerta, desde, checado_em, recuperacoes, situacao')
        .eq('tenant_id', tenantId)
        .maybeSingle(),
      supabase
        .from('monitor_eventos')
        .select('id, evento, estado, criado_em')
        .eq('tenant_id', tenantId)
        .order('criado_em', { ascending: false })
        .limit(5),
    ])

    if (!estado.error && estado.data) setLinha(estado.data as MonitorRow)
    if (!historico.error && historico.data) setEventos(historico.data as MonitorEvento[])
    setCarregando(false)
  }, [tenantId])

  useEffect(() => {
    if (!tenantId) return
    void carregar()
    const timer = window.setInterval(() => void carregar(), REFRESH_INTERVAL)
    return () => window.clearInterval(timer)
  }, [tenantId, carregar])

  // Enquanto não há leitura nenhuma, não vale a pena ocupar espaço na tela.
  if (!tenantId || carregando || !linha) return null

  const visual = APARENCIA[linha.situacao] ?? APARENCIA.nunca_checado

  return (
    <section className={`mt-6 rounded-2xl border px-5 py-4 ${visual.caixa}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="relative flex size-2.5">
          {linha.situacao !== 'conectado' && (
            <span className={`absolute inline-flex size-full animate-ping rounded-full opacity-60 ${visual.ponto}`} />
          )}
          <span className={`relative inline-flex size-2.5 rounded-full ${visual.ponto}`} />
        </span>
        <span className={`text-sm font-bold ${visual.texto}`}>{visual.rotulo}</span>
        <span className="text-xs text-ink-500">verificado {haQuantoTempo(linha.checado_em)}</span>
        {eventos.length > 0 && (
          <button
            type="button"
            onClick={() => setAberto((v) => !v)}
            className="ml-auto text-xs font-semibold text-ink-500 underline underline-offset-2 hover:text-ink-700"
          >
            {aberto ? 'ocultar histórico' : 'ver histórico'}
          </button>
        )}
      </div>

      <p className={`mt-1.5 text-sm leading-relaxed ${visual.texto}`}>{explicacao(linha)}</p>

      {aberto && (
        <ul className="mt-3 space-y-1 border-t border-white/60 pt-3">
          {eventos.map((evento) => (
            <li key={evento.id} className="flex flex-wrap items-baseline gap-x-2 text-xs text-ink-600">
              <span className="font-semibold">{EVENTOS[evento.evento] ?? evento.evento}</span>
              <span className="text-ink-400">
                {new Date(evento.criado_em).toLocaleString('pt-BR', {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
