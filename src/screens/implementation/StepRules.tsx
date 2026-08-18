import { useEffect, useState, type FormEvent } from 'react'
import { useTenant } from '../../core/tenant'
import { buildPrompts } from '../../core/prompts'
import { maskCnpj, maskPhone, onlyDigits } from '../../core/format'
import {
  AGENT_HINT,
  AGENT_LABEL,
  INSPECTION_LABEL,
  PARTNER_BANKS,
  type AgentType,
  type InspectionType,
} from '../../core/types'
import { Button } from '../../ui/Button'
import { CheckPill, Field, Input, Textarea, Toggle } from '../../ui/Field'
import { useToast } from '../../ui/Feedback'
import { SparkIcon } from '../../ui/icons'
import { InfoNote, StepCard } from './StepCard'

const AGENT_TYPES: AgentType[] = ['descoberta', 'encantamento', 'fechamento']

export function StepRules({ onNext }: { onNext: () => void }) {
  const { store, tenant, settings, agents, updateStore, updateTenant, updateSettings, updateAgent } = useTenant()
  const { toast } = useToast()

  const [name, setName] = useState('')
  const [cnpj, setCnpj] = useState('')
  const [phone, setPhone] = useState('')
  const [consignment, setConsignment] = useState(false)
  const [trade, setTrade] = useState(true)
  const [auction, setAuction] = useState(false)
  const [inspection, setInspection] = useState<InspectionType>('nenhum')
  const [banks, setBanks] = useState<string[]>([])
  const [mode, setMode] = useState<'24h' | 'custom'>('24h')
  const [start, setStart] = useState('18:00')
  const [end, setEnd] = useState('08:00')
  const [prompts, setPrompts] = useState<Record<AgentType, string>>({
    descoberta: '',
    encantamento: '',
    fechamento: '',
  })
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (store) {
      setName(store.name?.trim() ?? '')
      setCnpj(store.cnpj ? maskCnpj(store.cnpj) : '')
      setPhone(store.phone ? maskPhone(store.phone) : '')
      setConsignment(store.offers_consignment)
      setTrade(store.accepts_trade)
      setAuction(store.works_with_auction)
      setInspection(store.has_inspection ? store.inspection_type : 'nenhum')
      setBanks(store.partner_banks ?? [])
    }

    const horario = settings?.horario_atendimento?.trim()
    if (horario && horario !== '24h' && horario.includes('-')) {
      const [from, to] = horario.split('-')
      setMode('custom')
      setStart(from.trim().slice(0, 5))
      setEnd(to.trim().slice(0, 5))
    } else {
      setMode('24h')
    }
  }, [store?.id, settings?.tenant_id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!agents.length) return
    setPrompts({
      descoberta: agents.find((a) => a.agent_type === 'descoberta')?.system_prompt ?? '',
      encantamento: agents.find((a) => a.agent_type === 'encantamento')?.system_prompt ?? '',
      fechamento: agents.find((a) => a.agent_type === 'fechamento')?.system_prompt ?? '',
    })
  }, [agents])

  /** Os dados do formulário precisam estar no banco: quem monta o prompt é a RPC. */
  async function persistStoreData() {
    await updateStore({
      name: name.trim(),
      cnpj: onlyDigits(cnpj) || null,
      phone: onlyDigits(phone) || null,
      offers_consignment: consignment,
      accepts_trade: trade,
      works_with_auction: auction,
      has_inspection: inspection !== 'nenhum',
      inspection_type: inspection,
      partner_banks: banks,
    })

    if (tenant && tenant.nome !== name.trim()) {
      await updateTenant({ nome: name.trim() })
    }

    await updateSettings({
      horario_atendimento: mode === '24h' ? '24h' : `${start}-${end}`,
    })
  }

  /**
   * Remonta os três prompts: template-base (a essência da Júlia, gravada em
   * `prompt_templates`) + os dados que o lojista preencheu. Não sobrescreve
   * nada no banco — só preenche as caixas de texto para revisão.
   */
  async function generatePrompts() {
    if (!name.trim()) {
      setError('Informe o nome da loja antes de gerar os prompts.')
      return
    }
    if (!tenant?.id) {
      toast('Salve as regras uma vez antes de gerar os prompts.', 'info')
      return
    }

    setGenerating(true)
    setError(null)
    try {
      await persistStoreData()
      setPrompts(
        await buildPrompts(tenant.id, {
          ...store,
          name,
          offers_consignment: consignment,
          accepts_trade: trade,
          works_with_auction: auction,
          inspection_type: inspection,
          partner_banks: banks,
        }),
      )
      toast('Prompts remontados com o texto base + os dados da loja. Revise antes de salvar.', 'info')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não foi possível gerar os prompts.', 'error')
    } finally {
      setGenerating(false)
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) {
      setError('Informe o nome da loja.')
      return
    }

    setSaving(true)
    setError(null)

    try {
      await persistStoreData()

      // Um prompt por agente — o N8N lê tenant_agents.system_prompt
      for (const type of AGENT_TYPES) {
        const value = prompts[type].trim()
        const current = agents.find((agent) => agent.agent_type === type)?.system_prompt ?? ''
        if (value && value !== current) await updateAgent(type, value)
      }

      toast('Regras da loja salvas.')
      onNext()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar as regras.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <StepCard
        title="Regras da loja & comportamento da IA"
        description="Essas informações definem o que o agente pode prometer ao cliente e em que horário ele atende."
        footer={
          <Button type="submit" loading={saving}>
            Salvar e continuar
          </Button>
        }
      >
        <div className="space-y-8">
          <section className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Nome da loja"
              required
              className="sm:col-span-2"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Wissen Multimarcas"
            />
            <Input label="CNPJ" value={cnpj} onChange={(e) => setCnpj(maskCnpj(e.target.value))} placeholder="00.000.000/0001-00" />
            <Input
              label="Telefone de contato"
              value={phone}
              onChange={(e) => setPhone(maskPhone(e.target.value))}
              placeholder="(41) 99999-9999"
              hint="Telefone da loja para o cliente falar com um humano."
            />
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-bold text-ink-900">Regras comerciais</h3>
            <Toggle
              checked={consignment}
              onChange={setConsignment}
              label="Aceita consignação"
              description="A loja vende veículos de terceiros deixados em consignação."
            />
            <Toggle
              checked={trade}
              onChange={setTrade}
              label="Aceita troca"
              description="O carro usado do cliente pode entrar como parte do pagamento."
            />
            <Toggle
              checked={auction}
              onChange={setAuction}
              label="Trabalha com carro de leilão"
              description="A IA informa ao cliente quando o veículo tem origem de leilão."
            />
          </section>

          <section>
            <h3 className="text-sm font-bold text-ink-900">Pesquisa veicular / laudo cautelar</h3>
            <p className="mt-1 text-xs text-ink-500">O que a IA responde quando perguntarem sobre procedência.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(Object.keys(INSPECTION_LABEL) as InspectionType[]).map((type) => (
                <CheckPill key={type} checked={inspection === type} onChange={() => setInspection(type)}>
                  {INSPECTION_LABEL[type]}
                </CheckPill>
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-bold text-ink-900">Bancos parceiros para financiamento</h3>
            <p className="mt-1 text-xs text-ink-500">A IA só cita bancos selecionados aqui.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {PARTNER_BANKS.map((bank) => (
                <CheckPill
                  key={bank}
                  checked={banks.includes(bank)}
                  onChange={(checked) =>
                    setBanks((prev) => (checked ? [...prev, bank] : prev.filter((item) => item !== bank)))
                  }
                >
                  {bank}
                </CheckPill>
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-bold text-ink-900">Horário de atuação da IA</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setMode('24h')}
                className={`rounded-2xl border p-4 text-left transition-all ${
                  mode === '24h' ? 'border-brand-600 bg-brand-50' : 'border-ink-200 bg-white hover:border-ink-300'
                }`}
              >
                <span className="block text-sm font-bold text-ink-900">24 horas</span>
                <span className="mt-0.5 block text-xs text-ink-500">O agente responde a qualquer hora, todos os dias.</span>
              </button>
              <button
                type="button"
                onClick={() => setMode('custom')}
                className={`rounded-2xl border p-4 text-left transition-all ${
                  mode === 'custom' ? 'border-brand-600 bg-brand-50' : 'border-ink-200 bg-white hover:border-ink-300'
                }`}
              >
                <span className="block text-sm font-bold text-ink-900">Horário específico</span>
                <span className="mt-0.5 block text-xs text-ink-500">Fora do horário, a conversa fica com a equipe.</span>
              </button>
            </div>

            {mode === 'custom' && (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="Início">
                  <input
                    type="time"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                    className="w-full rounded-2xl border border-ink-200 bg-white px-4 py-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/10"
                  />
                </Field>
                <Field label="Fim" hint="Pode virar o dia — ex.: das 18:00 às 08:00.">
                  <input
                    type="time"
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                    className="w-full rounded-2xl border border-ink-200 bg-white px-4 py-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/10"
                  />
                </Field>
              </div>
            )}
          </section>

          <section>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-ink-900">
                  Prompts do agente {agents[0]?.nome_agente ? `(${agents[0].nome_agente})` : ''}
                </h3>
                <p className="mt-1 text-xs text-ink-500">As três fases da conversa, lidas pelo fluxo do N8N.</p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={generatePrompts}
                disabled={generating}
                icon={<SparkIcon className="size-4" />}
              >
                {generating ? 'Gerando…' : 'Gerar sugestão'}
              </Button>
            </div>

            <div className="mt-4 space-y-4">
              {AGENT_TYPES.map((type) => (
                <Textarea
                  key={type}
                  label={AGENT_LABEL[type]}
                  hint={`${AGENT_HINT[type]} ${prompts[type].length.toLocaleString('pt-BR')} caracteres.`}
                  value={prompts[type]}
                  onChange={(e) => setPrompts((prev) => ({ ...prev, [type]: e.target.value }))}
                />
              ))}
            </div>
          </section>

          {error && <InfoNote tone="red">{error}</InfoNote>}
        </div>
      </StepCard>
    </form>
  )
}
