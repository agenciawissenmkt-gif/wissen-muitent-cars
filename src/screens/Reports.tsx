import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useAuth } from '../core/auth'
import { supabase } from '../core/supabase'
import { useTenant } from '../core/tenant'
import { Button } from '../ui/Button'
import { EmptyState, useToast } from '../ui/Feedback'
import { Input, Toggle } from '../ui/Field'
import { CalendarIcon, MailIcon, PlusIcon, ReportIcon, TrashIcon, WhatsappIcon } from '../ui/icons'

/**
 * Relatórios da Júlia.
 *
 * Toda sexta às 19h (horário de Brasília) a Wissen envia um PDF com a semana da
 * Júlia: por e-mail para o dono da loja (o Gmail do login) e pelo WhatsApp da
 * Wissen para os números cadastrados aqui. O histórico fica logo abaixo.
 *
 * Os dados ficam em report_settings e store_reports (RLS: só a própria loja) e o
 * PDF no bucket privado `relatorios`, aberto por link temporário.
 */

interface ReportRow {
  id: string
  kind: 'semanal' | 'manual'
  status: 'gerando' | 'enviado' | 'parcial' | 'falhou' | 'sem_destino'
  period_start: string
  period_end: string
  pdf_path: string | null
  whatsapp_sent_at: string | null
  email_sent_at: string | null
  created_at: string
  metrics: { clientes?: number; conversas?: number; visitas?: { agendadas?: number } } | null
}

const STATUS: Record<ReportRow['status'], { label: string; tone: string }> = {
  enviado: { label: 'Enviado', tone: 'bg-emerald-50 text-emerald-700' },
  parcial: { label: 'Enviado em parte', tone: 'bg-amber-50 text-amber-700' },
  falhou: { label: 'Não enviado', tone: 'bg-red-50 text-red-700' },
  sem_destino: { label: 'Gerado', tone: 'bg-ink-100 text-ink-600' },
  gerando: { label: 'Gerando…', tone: 'bg-brand-50 text-brand-700' },
}

const day = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })
const dayYear = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' })

function formatPhone(digits: string) {
  const d = digits.replace(/\D/g, '').replace(/^55/, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return digits
}

/** Próxima sexta 19h no horário de Brasília (UTC-3). */
function nextFriday() {
  const now = new Date()
  const sp = new Date(now.getTime() - 3 * 3600000)
  let days = (5 - sp.getUTCDay() + 7) % 7
  if (days === 0 && sp.getUTCHours() >= 19) days = 7
  const target = new Date(Date.UTC(sp.getUTCFullYear(), sp.getUTCMonth(), sp.getUTCDate() + days, 22))
  const text = target.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: '2-digit' })
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function Reports() {
  const { store } = useTenant()
  const { user } = useAuth()
  const { toast } = useToast()
  const tenantId = store?.tenant_id ?? null

  const [numbers, setNumbers] = useState<string[]>([])
  const [emails, setEmails] = useState<string[]>([])
  const [active, setActive] = useState(true)
  const [newNumber, setNewNumber] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [reports, setReports] = useState<ReportRow[]>([])
  const [opening, setOpening] = useState<string | null>(null)

  const ownerEmail = user?.email?.toLowerCase() ?? null

  const load = useCallback(async () => {
    if (!tenantId) return
    setLoading(true)
    const [settings, history] = await Promise.all([
      supabase.from('report_settings').select('whatsapp_numbers,emails,active').eq('tenant_id', tenantId).maybeSingle(),
      supabase
        .from('store_reports')
        .select('id,kind,status,period_start,period_end,pdf_path,whatsapp_sent_at,email_sent_at,created_at,metrics')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(30),
    ])
    setNumbers(settings.data?.whatsapp_numbers ?? [])
    setEmails((settings.data?.emails ?? []).filter((e: string) => e !== ownerEmail))
    setActive(settings.data?.active ?? true)
    setReports((history.data as ReportRow[] | null) ?? [])
    setLoading(false)
  }, [tenantId, ownerEmail])

  useEffect(() => {
    void load()
  }, [load])

  async function save(next: { numbers?: string[]; emails?: string[]; active?: boolean }) {
    if (!tenantId) return false
    setSaving(true)
    const { error } = await supabase.from('report_settings').upsert({
      tenant_id: tenantId,
      whatsapp_numbers: next.numbers ?? numbers,
      emails: next.emails ?? emails,
      active: next.active ?? active,
    })
    setSaving(false)
    if (error) {
      toast(error.message.includes('inválid') || error.message.includes('máximo') ? error.message : 'Não foi possível salvar agora.', 'error')
      return false
    }
    await load()
    return true
  }

  async function addNumber() {
    const digits = newNumber.replace(/\D/g, '')
    if (digits.length < 10) {
      toast('Digite o número com DDD, por exemplo (41) 99999-9999.', 'error')
      return
    }
    if (numbers.length >= 3) return
    if (await save({ numbers: [...numbers, digits] })) {
      setNewNumber('')
      toast('Número cadastrado. Ele recebe o próximo relatório.')
    }
  }

  async function addEmail() {
    const email = newEmail.trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      toast('Digite um e-mail válido.', 'error')
      return
    }
    if (email === ownerEmail || emails.length >= 3) return
    if (await save({ emails: [...emails, email] })) {
      setNewEmail('')
      toast('E-mail cadastrado.')
    }
  }

  async function openPdf(report: ReportRow) {
    if (!report.pdf_path) return
    setOpening(report.id)
    const win = window.open('', '_blank')
    const { data, error } = await supabase.storage.from('relatorios').createSignedUrl(report.pdf_path, 300)
    setOpening(null)
    if (error || !data?.signedUrl) {
      win?.close()
      toast('Não foi possível abrir o PDF agora.', 'error')
      return
    }
    if (win) win.location.href = data.signedUrl
    else window.location.href = data.signedUrl
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
      <header>
        <h1 className="text-2xl font-extrabold text-ink-900 sm:text-3xl">Relatórios</h1>
        <p className="mt-1 text-sm text-ink-500">O resumo da semana da Júlia, em PDF, direto no seu WhatsApp e no seu e-mail.</p>
      </header>

      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="mt-6 overflow-hidden rounded-3xl bg-gradient-to-br from-[#5b1a96] via-brand-800 to-[#2e1065] p-6 text-white shadow-xl shadow-brand-900/20 sm:p-8"
      >
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-xl">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-200">Relatório semanal</p>
            <h2 className="mt-2 text-xl font-extrabold sm:text-2xl">Toda sexta-feira às 19h</h2>
            <p className="mt-2 text-sm leading-relaxed text-brand-100">
              Clientes que chamaram, conversas, fotos enviadas, visitas agendadas, transferências para os vendedores, tempo de
              resposta da equipe, vendas e o que os clientes disseram. Cobre de sábado a sexta, no horário de Brasília.
            </p>
          </div>
          <div className="rounded-2xl bg-white/10 px-5 py-4 ring-1 ring-white/15">
            <p className="flex items-center gap-2 text-xs font-semibold text-brand-200">
              <CalendarIcon className="size-4" /> Próximo envio
            </p>
            <p className="mt-1 text-lg font-bold">{active ? `${nextFriday()}, 19h` : 'Pausado'}</p>
          </div>
        </div>
      </motion.section>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <section className="rounded-3xl border border-ink-100 bg-white p-6 shadow-sm">
          <h3 className="flex items-center gap-2 text-base font-bold text-ink-900">
            <MailIcon className="text-brand-600" /> Por e-mail
          </h3>
          <p className="mt-1 text-sm text-ink-500">Enviado pelo e-mail da Wissen (agenciawissenmkt@gmail.com).</p>

          <ul className="mt-4 space-y-2">
            {ownerEmail && (
              <li className="flex items-center justify-between gap-3 rounded-2xl bg-brand-50 px-4 py-3 text-sm">
                <span className="min-w-0 truncate font-semibold text-ink-900">{ownerEmail}</span>
                <span className="shrink-0 rounded-full bg-white px-2.5 py-0.5 text-xs font-bold text-brand-700">dono da loja</span>
              </li>
            )}
            {emails.map((email) => (
              <li key={email} className="flex items-center justify-between gap-3 rounded-2xl border border-ink-100 px-4 py-3 text-sm">
                <span className="min-w-0 truncate text-ink-800">{email}</span>
                <button type="button" aria-label={`Remover ${email}`} disabled={saving} onClick={() => void save({ emails: emails.filter((e) => e !== email) })} className="rounded-xl p-1.5 text-ink-400 hover:bg-red-50 hover:text-red-600">
                  <TrashIcon className="size-4" />
                </button>
              </li>
            ))}
          </ul>

          {emails.length < 3 && (
            <div className="mt-4 flex items-end gap-2">
              <div className="flex-1">
                <Input label="Outro e-mail (opcional)" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="gerente@minhaloja.com.br" onKeyDown={(e) => e.key === 'Enter' && void addEmail()} />
              </div>
              <Button variant="secondary" icon={<PlusIcon className="size-4" />} loading={saving} onClick={() => void addEmail()} className="h-[46px] rounded-2xl px-4">
                Adicionar
              </Button>
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-ink-100 bg-white p-6 shadow-sm">
          <h3 className="flex items-center gap-2 text-base font-bold text-ink-900">
            <WhatsappIcon className="text-emerald-600" /> Pelo WhatsApp
          </h3>
          <p className="mt-1 text-sm text-ink-500">Enviado pelo WhatsApp da Wissen, (41) 99509-6228. Até 3 números.</p>

          <ul className="mt-4 space-y-2">
            {numbers.length === 0 && !loading && (
              <li className="rounded-2xl border border-dashed border-ink-200 px-4 py-3 text-sm text-ink-400">Nenhum número cadastrado ainda.</li>
            )}
            {numbers.map((number) => (
              <li key={number} className="flex items-center justify-between gap-3 rounded-2xl border border-ink-100 px-4 py-3 text-sm">
                <span className="font-semibold text-ink-800">{formatPhone(number)}</span>
                <button type="button" aria-label={`Remover ${formatPhone(number)}`} disabled={saving} onClick={() => void save({ numbers: numbers.filter((n) => n !== number) })} className="rounded-xl p-1.5 text-ink-400 hover:bg-red-50 hover:text-red-600">
                  <TrashIcon className="size-4" />
                </button>
              </li>
            ))}
          </ul>

          {numbers.length < 3 && (
            <div className="mt-4 flex items-end gap-2">
              <div className="flex-1">
                <Input label="Número de WhatsApp" inputMode="tel" value={newNumber} onChange={(e) => setNewNumber(e.target.value)} placeholder="(41) 99999-9999" onKeyDown={(e) => e.key === 'Enter' && void addNumber()} />
              </div>
              <Button icon={<PlusIcon className="size-4" />} loading={saving} onClick={() => void addNumber()} className="h-[46px] rounded-2xl px-4">
                Cadastrar
              </Button>
            </div>
          )}
        </section>
      </div>

      <div className="mt-5">
        <Toggle
          checked={active}
          onChange={(value) => {
            setActive(value)
            void save({ active: value })
          }}
          label="Receber o relatório toda sexta"
          description={active ? 'Ligado: o relatório chega toda sexta às 19h.' : 'Pausado: nenhum relatório automático será enviado até você religar.'}
        />
      </div>

      <section className="mt-8">
        <h3 className="text-lg font-bold text-ink-900">Relatórios enviados</h3>
        <p className="mt-1 text-sm text-ink-500">Abra o PDF de qualquer semana.</p>

        <div className="mt-4">
          {!loading && reports.length === 0 ? (
            <EmptyState icon={<ReportIcon className="size-6" />} title="Nenhum relatório ainda" description={`O primeiro chega na ${nextFriday().toLowerCase()}, às 19h.`} />
          ) : (
            <ul className="space-y-3">
              {reports.map((report) => (
                <li key={report.id} className="flex flex-wrap items-center gap-4 rounded-3xl border border-ink-100 bg-white p-4 shadow-sm sm:p-5">
                  <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-700">
                    <ReportIcon className="size-6" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-ink-900">
                      Semana de {day(report.period_start)} a {dayYear(report.period_end)}
                    </p>
                    <p className="mt-0.5 text-sm text-ink-500">
                      {report.metrics
                        ? `${report.metrics.clientes ?? 0} clientes · ${report.metrics.conversas ?? 0} conversas · ${report.metrics.visitas?.agendadas ?? 0} visitas agendadas`
                        : 'Resumo indisponível'}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                      <span className={`rounded-full px-2.5 py-0.5 font-bold ${STATUS[report.status].tone}`}>{STATUS[report.status].label}</span>
                      {report.email_sent_at && <span className="flex items-center gap-1 text-ink-500"><MailIcon className="size-3.5" /> e-mail</span>}
                      {report.whatsapp_sent_at && <span className="flex items-center gap-1 text-ink-500"><WhatsappIcon className="size-3.5" /> WhatsApp</span>}
                      {report.kind === 'manual' && <span className="text-ink-400">enviado pela Wissen</span>}
                    </p>
                  </div>
                  {report.pdf_path && (
                    <Button variant="secondary" size="sm" loading={opening === report.id} onClick={() => void openPdf(report)} className="rounded-2xl">
                      Abrir PDF
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  )
}
