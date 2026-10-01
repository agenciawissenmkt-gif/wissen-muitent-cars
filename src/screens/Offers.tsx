import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../core/supabase'
import { useTenant } from '../core/tenant'
import {
  CAR_OFFER_STATUS_LABEL,
  CAR_OFFER_TIPO_LABEL,
  type CarOffer,
  type CarOfferStatus,
} from '../core/types'
import { Button } from '../ui/Button'
import { EmptyState, SkeletonCard, useToast } from '../ui/Feedback'
import { CarIcon, ChatIcon, WhatsappIcon } from '../ui/icons'

/**
 * Carros oferecidos.
 *
 * Quando um cliente quer vender o carro dele para a loja ou deixar em consignação, o
 * agente de Captação da Júlia tira as dúvidas, levanta os dados e as fotos e registra
 * aqui (tabela car_offers, RLS: só a própria loja). Quem avalia, faz a proposta e fecha
 * é o consultor: a Júlia nunca dá valor. O status é a loja que muda.
 */

type Filtro = 'abertos' | 'fechados' | 'todos'

const ABERTOS: CarOfferStatus[] = ['novo', 'em_avaliacao']
const STATUS_ORDEM: CarOfferStatus[] = ['novo', 'em_avaliacao', 'comprado', 'consignado', 'recusado', 'desistiu']

const STATUS_TOM: Record<CarOfferStatus, string> = {
  novo: 'bg-brand-50 text-brand-700 ring-brand-200',
  em_avaliacao: 'bg-amber-50 text-amber-700 ring-amber-200',
  comprado: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  consignado: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  recusado: 'bg-ink-100 text-ink-600 ring-ink-200',
  desistiu: 'bg-ink-100 text-ink-600 ring-ink-200',
}

const brl = (v: CarOffer['preco_pedido']) => {
  const n = Number(v)
  return v === null || v === undefined || Number.isNaN(n) ? null : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}
const km = (v: number | null) => (v === null || v === undefined ? null : `${v.toLocaleString('pt-BR')} km`)
const quando = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

function telefone(digits: string | null) {
  const d = String(digits ?? '').replace(/\D/g, '').replace(/^55/, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return digits ?? ''
}

function titulo(o: CarOffer) {
  const nome = [o.marca, o.modelo, o.versao].filter(Boolean).join(' ').trim()
  return [nome || 'Carro sem modelo informado', o.ano].filter(Boolean).join(' ')
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string | null | undefined }) {
  if (!valor) return null
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">{rotulo}</dt>
      <dd className="mt-0.5 text-sm text-ink-800">{valor}</dd>
    </div>
  )
}

export function Offers() {
  const { store } = useTenant()
  const { toast } = useToast()
  const tenantId = store?.tenant_id ?? null
  const [ofertas, setOfertas] = useState<CarOffer[]>([])
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState<Filtro>('abertos')
  const [salvando, setSalvando] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!tenantId) return
    setLoading(true)
    const { data, error } = await supabase
      .from('car_offers')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) toast('Não foi possível carregar os carros oferecidos.', 'error')
    else setOfertas((data as CarOffer[]).map((o) => ({ ...o, fotos: Array.isArray(o.fotos) ? o.fotos : [] })))
    setLoading(false)
  }, [tenantId, toast])

  useEffect(() => {
    void carregar()
  }, [carregar])

  const visiveis = useMemo(() => {
    if (filtro === 'todos') return ofertas
    if (filtro === 'abertos') return ofertas.filter((o) => ABERTOS.includes(o.status))
    return ofertas.filter((o) => !ABERTOS.includes(o.status))
  }, [ofertas, filtro])

  const contagem = useMemo(
    () => ({
      abertos: ofertas.filter((o) => ABERTOS.includes(o.status)).length,
      fechados: ofertas.filter((o) => !ABERTOS.includes(o.status)).length,
      todos: ofertas.length,
    }),
    [ofertas],
  )

  async function mudarStatus(oferta: CarOffer, status: CarOfferStatus) {
    setSalvando(oferta.id)
    const { error } = await supabase
      .from('car_offers')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', oferta.id)
    setSalvando(null)
    if (error) {
      toast('Não foi possível mudar o status.', 'error')
      return
    }
    setOfertas((atual) => atual.map((o) => (o.id === oferta.id ? { ...o, status } : o)))
    toast(`Marcado como "${CAR_OFFER_STATUS_LABEL[status]}".`)
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-ink-900 sm:text-3xl">Carros oferecidos</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-500">
            Clientes que querem vender o carro para a loja ou deixar em consignação. A Júlia tira as dúvidas, levanta os
            dados e as fotos e passa para o consultor — ela nunca dá valor. Quem avalia e fecha é a loja.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void carregar()} loading={loading}>
          Atualizar
        </Button>
      </header>

      <div className="mt-6 flex flex-wrap gap-2">
        {(
          [
            ['abertos', 'Em aberto'],
            ['fechados', 'Finalizados'],
            ['todos', 'Todos'],
          ] as [Filtro, string][]
        ).map(([valor, rotulo]) => (
          <button
            key={valor}
            type="button"
            onClick={() => setFiltro(valor)}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-all ${
              filtro === valor ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-200 bg-white text-ink-700 hover:border-brand-300'
            }`}
          >
            {rotulo} <span className="opacity-70">{contagem[valor]}</span>
          </button>
        ))}
      </div>

      <div className="mt-6">
        {loading && ofertas.length === 0 ? (
          <div className="grid gap-5 lg:grid-cols-2">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : visiveis.length === 0 ? (
          <EmptyState
            icon={<CarIcon />}
            title={filtro === 'abertos' ? 'Nenhum carro oferecido em aberto' : 'Nenhum carro por aqui'}
            description="Quando um cliente quiser vender o carro dele ou deixar em consignação, a Júlia registra aqui com os dados e as fotos que ele mandar."
          />
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            {visiveis.map((o) => (
              <motion.article
                key={o.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col overflow-hidden rounded-3xl border border-ink-100 bg-white shadow-sm"
              >
                {o.fotos.length > 0 && (
                  <div className="flex gap-1 overflow-x-auto bg-ink-50 p-1">
                    {o.fotos.slice(0, 8).map((url) => (
                      <a key={url} href={url} target="_blank" rel="noreferrer" className="shrink-0">
                        <img src={url} alt="" loading="lazy" className="h-28 w-40 rounded-2xl object-cover" />
                      </a>
                    ))}
                  </div>
                )}
                <div className="flex flex-1 flex-col gap-4 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-bold uppercase tracking-wide text-brand-600">{CAR_OFFER_TIPO_LABEL[o.tipo]}</p>
                      <h2 className="mt-0.5 text-lg font-bold text-ink-900">{titulo(o)}</h2>
                      <p className="mt-0.5 text-xs text-ink-400">
                        Chegou em {quando(o.created_at)}
                        {o.updated_at !== o.created_at ? ` · atualizado em ${quando(o.updated_at)}` : ''}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ring-1 ${STATUS_TOM[o.status]}`}>
                      {CAR_OFFER_STATUS_LABEL[o.status]}
                    </span>
                  </div>

                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                    <Linha rotulo="Quilometragem" valor={km(o.km)} />
                    <Linha rotulo="Cor" valor={o.cor} />
                    <Linha rotulo="Preço que o cliente quer" valor={brl(o.preco_pedido)} />
                    <Linha
                      rotulo="Quitação"
                      valor={o.quitado === null ? null : o.quitado ? 'Quitado' : `Financiado${o.financiamento_detalhes ? ` — ${o.financiamento_detalhes}` : ''}`}
                    />
                    <Linha rotulo="Cidade" valor={o.cidade} />
                    <Linha rotulo="Pressa" valor={o.urgencia} />
                  </dl>

                  <dl className="space-y-3">
                    <Linha rotulo="Estado" valor={o.estado} />
                    <Linha rotulo="Histórico" valor={o.historico} />
                    <Linha rotulo="IPVA e licenciamento" valor={o.documentacao} />
                    <Linha rotulo="Observações" valor={o.observacoes} />
                  </dl>

                  <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-ink-100 pt-4">
                    <div className="mr-auto min-w-0 text-sm">
                      <p className="truncate font-semibold text-ink-900">{o.cliente_nome || 'Cliente'}</p>
                      <p className="text-xs text-ink-500">{telefone(o.cliente_telefone)}</p>
                    </div>
                    {o.conversa_url && (
                      <a
                        href={o.conversa_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-xl border border-ink-200 px-3 py-2 text-xs font-semibold text-ink-700 hover:border-brand-300"
                      >
                        <ChatIcon className="size-4" /> Conversa
                      </a>
                    )}
                    {o.cliente_telefone && (
                      <a
                        href={`https://wa.me/${String(o.cliente_telefone).replace(/\D/g, '')}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-xl border border-ink-200 px-3 py-2 text-xs font-semibold text-ink-700 hover:border-emerald-300"
                      >
                        <WhatsappIcon className="size-4 text-emerald-600" /> WhatsApp
                      </a>
                    )}
                    <select
                      aria-label="Status"
                      value={o.status}
                      disabled={salvando === o.id}
                      onChange={(e) => void mudarStatus(o, e.target.value as CarOfferStatus)}
                      className="rounded-xl border border-ink-200 bg-white px-3 py-2 text-xs font-semibold text-ink-700 focus:border-brand-500 focus:outline-none"
                    >
                      {STATUS_ORDEM.map((s) => (
                        <option key={s} value={s}>
                          {CAR_OFFER_STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </motion.article>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
