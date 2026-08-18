import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useTenant } from '../../core/tenant'
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
import { CheckPill, Field, Input, Select, Textarea, Toggle } from '../../ui/Field'
import { useToast } from '../../ui/Feedback'
import { InfoNote, StepCard } from './StepCard'

const AGENT_TYPES: AgentType[] = ['descoberta', 'encantamento', 'fechamento']

const PAYMENT_METHODS = ['À vista', 'Financiamento', 'Consórcio', 'Cartão de crédito', 'Pix', 'Troca'] as const
const VEHICLE_CATEGORIES = ['Hatch', 'Sedã', 'SUV', 'Picape', 'Utilitário', 'Esportivo', 'Van'] as const
const VEHICLE_CONDITIONS = ['Seminovo', 'Usado', 'Zero km', 'Leilão'] as const
const UFS = [
  'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO',
] as const

const INSPECTION_OPTIONS = ['nenhum', 'pesquisa', 'completo'] as const

/** Cada bloco da etapa 1. O título deixa claro o que aquele grupo alimenta na IA. */
function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-t border-ink-100 pt-6 first:border-0 first:pt-0">
      <div>
        <h3 className="text-sm font-bold text-ink-900">{title}</h3>
        {hint && <p className="mt-1 text-xs leading-relaxed text-ink-500">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

/** Alterna um item dentro de uma lista de seleção múltipla. */
function toggleIn(list: string[], value: string, checked: boolean) {
  return checked ? [...new Set([...list, value])] : list.filter((item) => item !== value)
}

export function StepRules({ onNext }: { onNext: () => void }) {
  const { store, tenant, settings, agents, salespeople, updateStore, updateTenant, updateSettings, refresh } =
    useTenant()
  const { toast } = useToast()

  // --- Identificação
  const [name, setName] = useState('')
  const [legalName, setLegalName] = useState('')
  const [cnpj, setCnpj] = useState('')
  const [phone, setPhone] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [email, setEmail] = useState('')
  const [website, setWebsite] = useState('')
  const [instagram, setInstagram] = useState('')

  // --- Endereço
  const [street, setStreet] = useState('')
  const [number, setNumber] = useState('')
  const [complement, setComplement] = useState('')
  const [district, setDistrict] = useState('')
  const [city, setCity] = useState('')
  const [uf, setUf] = useState('')
  const [zip, setZip] = useState('')
  const [mapsUrl, setMapsUrl] = useState('')

  // --- Horário
  const [mode, setMode] = useState<'24h' | 'custom'>('24h')
  const [start, setStart] = useState('18:00')
  const [end, setEnd] = useState('08:00')

  // --- Regras comerciais
  const [trade, setTrade] = useState(true)
  const [financing, setFinancing] = useState(true)
  const [consignment, setConsignment] = useState(false)
  const [auction, setAuction] = useState(false)
  const [testDrive, setTestDrive] = useState(true)
  const [delivery, setDelivery] = useState(false)
  const [documentation, setDocumentation] = useState(false)
  const [inspection, setInspection] = useState<InspectionType>('nenhum')
  const [warrantyMonths, setWarrantyMonths] = useState('')
  const [warrantyDetails, setWarrantyDetails] = useState('')

  // --- Listas
  const [banks, setBanks] = useState<string[]>([])
  const [payments, setPayments] = useState<string[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [conditions, setConditions] = useState<string[]>([])

  // --- Texto livre
  const [differentials, setDifferentials] = useState('')
  const [serviceNotes, setServiceNotes] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!store) return
    setName(store.name?.trim() ?? '')
    setLegalName(store.legal_name ?? '')
    setCnpj(store.cnpj ? maskCnpj(store.cnpj) : '')
    setPhone(store.phone ? maskPhone(store.phone) : '')
    setWhatsapp(store.whatsapp ? maskPhone(store.whatsapp) : '')
    setEmail(store.email ?? '')
    setWebsite(store.website ?? '')
    setInstagram(store.instagram ?? '')

    setStreet(store.address_street ?? '')
    setNumber(store.address_number ?? '')
    setComplement(store.address_complement ?? '')
    setDistrict(store.address_district ?? '')
    setCity(store.address_city ?? '')
    setUf(store.address_state ?? '')
    setZip(store.address_zip ?? '')
    setMapsUrl(store.maps_url ?? '')

    setTrade(store.accepts_trade)
    setFinancing(store.offers_financing)
    setConsignment(store.offers_consignment)
    setAuction(store.works_with_auction)
    setTestDrive(store.offers_test_drive)
    setDelivery(store.offers_delivery)
    setDocumentation(store.offers_documentation)
    setInspection(store.has_inspection ? store.inspection_type : 'nenhum')
    setWarrantyMonths(store.warranty_months ? String(store.warranty_months) : '')
    setWarrantyDetails(store.warranty_details ?? '')

    setBanks(store.partner_banks ?? [])
    setPayments(store.payment_methods ?? [])
    setCategories(store.vehicle_categories ?? [])
    setConditions(store.vehicle_conditions ?? [])

    setDifferentials(store.differentials ?? '')
    setServiceNotes(store.service_notes ?? '')
  }, [store?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const horario = settings?.horario_atendimento?.trim()
    if (horario && horario !== '24h' && horario.includes('-')) {
      const [from, to] = horario.split('-')
      setMode('custom')
      setStart(from.trim().slice(0, 5))
      setEnd(to.trim().slice(0, 5))
    } else {
      setMode('24h')
    }
  }, [settings?.tenant_id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) {
      setError('Informe o nome da concessionária.')
      return
    }

    setSaving(true)
    setError(null)

    try {
      // Tudo gravado na linha da própria loja (stores.id) — nenhum dado cruza tenants.
      await updateStore({
        name: name.trim(),
        legal_name: legalName.trim() || null,
        cnpj: onlyDigits(cnpj) || null,
        phone: onlyDigits(phone) || null,
        whatsapp: onlyDigits(whatsapp) || null,
        email: email.trim() || null,
        website: website.trim() || null,
        instagram: instagram.trim().replace(/^@/, '') || null,

        address_street: street.trim() || null,
        address_number: number.trim() || null,
        address_complement: complement.trim() || null,
        address_district: district.trim() || null,
        address_city: city.trim() || null,
        address_state: uf || null,
        address_zip: onlyDigits(zip) || null,
        maps_url: mapsUrl.trim() || null,

        accepts_trade: trade,
        offers_financing: financing,
        offers_consignment: consignment,
        works_with_auction: auction,
        offers_test_drive: testDrive,
        offers_delivery: delivery,
        offers_documentation: documentation,
        has_inspection: inspection !== 'nenhum',
        inspection_type: inspection,
        warranty_months: Number(warrantyMonths) || 0,
        warranty_details: warrantyDetails.trim() || null,

        partner_banks: banks,
        payment_methods: payments,
        vehicle_categories: categories,
        vehicle_conditions: conditions,

        differentials: differentials.trim() || null,
        service_notes: serviceNotes.trim() || null,
      })

      if (tenant && tenant.nome !== name.trim()) {
        await updateTenant({ nome: name.trim() })
      }

      await updateSettings({
        horario_atendimento: mode === '24h' ? '24h' : `${start}-${end}`,
      })

      // Os prompts se remontam sozinhos no banco a partir destes dados.
      await refresh()
      toast('Dados da concessionária salvos. Os prompts da IA foram atualizados.')
      onNext()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar os dados.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <StepCard
        title="A concessionária"
        description="Estes dados alimentam automaticamente o atendimento da IA. O texto base da Júlia é o mesmo para toda a plataforma — o que muda de loja para loja é só o que você preenche aqui."
        footer={
          <Button type="submit" loading={saving}>
            Salvar e continuar
          </Button>
        }
      >
        <div className="space-y-6">
          <Section
            title="Identificação"
            hint="Como a loja se apresenta ao cliente e por onde ele consegue falar com vocês fora do WhatsApp."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Nome da concessionária"
                required
                className="sm:col-span-2"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Wissen Multimarcas"
                hint="É este nome que a IA usa ao se apresentar."
              />
              <Input
                label="Razão social"
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                placeholder="Wissen Comércio de Veículos Ltda"
              />
              <Input
                label="CNPJ"
                value={cnpj}
                onChange={(e) => setCnpj(maskCnpj(e.target.value))}
                placeholder="00.000.000/0001-00"
              />
              <Input
                label="Telefone de contato"
                value={phone}
                onChange={(e) => setPhone(maskPhone(e.target.value))}
                placeholder="(41) 99999-9999"
                hint="Telefone da loja para o cliente falar com um humano."
              />
              <Input
                label="WhatsApp comercial"
                value={whatsapp}
                onChange={(e) => setWhatsapp(maskPhone(e.target.value))}
                placeholder="(41) 99999-9999"
              />
              <Input
                label="E-mail"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="contato@sualoja.com.br"
              />
              <Input
                label="Site"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="www.sualoja.com.br"
              />
              <Input
                label="Instagram"
                prefix="@"
                className="sm:col-span-2"
                value={instagram}
                onChange={(e) => setInstagram(e.target.value)}
                placeholder="sualoja"
              />
            </div>
          </Section>

          <Section
            title="Endereço"
            hint="Usado quando a IA agenda uma visita ou um test-drive e precisa dizer onde o cliente deve ir."
          >
            <div className="grid gap-4 sm:grid-cols-6">
              <Input
                label="Rua"
                className="sm:col-span-4"
                value={street}
                onChange={(e) => setStreet(e.target.value)}
                placeholder="Av. do Batel"
              />
              <Input
                label="Número"
                className="sm:col-span-2"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                placeholder="344"
              />
              <Input
                label="Complemento"
                className="sm:col-span-3"
                value={complement}
                onChange={(e) => setComplement(e.target.value)}
                placeholder="Loja 2"
              />
              <Input
                label="Bairro"
                className="sm:col-span-3"
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                placeholder="Batel"
              />
              <Input
                label="Cidade"
                className="sm:col-span-3"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Curitiba"
              />
              <Select
                label="UF"
                className="sm:col-span-1"
                options={UFS}
                placeholder="—"
                value={uf}
                onChange={(e) => setUf(e.target.value)}
              />
              <Input
                label="CEP"
                className="sm:col-span-2"
                value={zip}
                onChange={(e) => setZip(e.target.value)}
                placeholder="80420-090"
              />
              <Input
                label="Link do Google Maps"
                className="sm:col-span-6"
                value={mapsUrl}
                onChange={(e) => setMapsUrl(e.target.value)}
                placeholder="https://maps.app.goo.gl/..."
                hint="A IA envia este link para o cliente que perguntar como chegar."
              />
            </div>
          </Section>

          <Section
            title="Horário de atendimento"
            hint="Fora do horário, a IA continua respondendo — ela só avisa que um vendedor humano retorna no próximo expediente."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Toggle
                checked={mode === '24h'}
                onChange={(value) => setMode(value ? '24h' : 'custom')}
                label="Atendimento 24 horas"
                description="A IA responde a qualquer hora, todos os dias."
              />
              <Toggle
                checked={mode === 'custom'}
                onChange={(value) => setMode(value ? 'custom' : '24h')}
                label="Faixa de horário"
                description="Defina o período em que a equipe está disponível."
              />
            </div>
            {mode === 'custom' && (
              <div className="grid gap-4 sm:grid-cols-2">
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
          </Section>

          <Section
            title="Regras comerciais"
            hint="A IA só promete o que estiver marcado aqui. O que estiver desligado ela nunca oferece."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Toggle
                checked={trade}
                onChange={setTrade}
                label="Aceita troca"
                description="O carro usado do cliente pode entrar como parte do pagamento."
              />
              <Toggle
                checked={financing}
                onChange={setFinancing}
                label="Trabalha com financiamento"
                description="A IA pode falar de entrada, parcelas e simulação."
              />
              <Toggle
                checked={consignment}
                onChange={setConsignment}
                label="Aceita consignação"
                description="A loja vende veículos de terceiros deixados em consignação."
              />
              <Toggle
                checked={auction}
                onChange={setAuction}
                label="Trabalha com leilão"
                description="A origem de leilão é sempre informada ao cliente."
              />
              <Toggle
                checked={testDrive}
                onChange={setTestDrive}
                label="Oferece test-drive"
                description="A IA pode convidar o cliente para dirigir o carro."
              />
              <Toggle
                checked={delivery}
                onChange={setDelivery}
                label="Entrega o veículo"
                description="A loja leva o carro até a casa do cliente."
              />
              <Toggle
                checked={documentation}
                onChange={setDocumentation}
                label="Cuida da documentação"
                description="A transferência fica por conta da loja."
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                label="Laudo dos veículos"
                options={INSPECTION_OPTIONS.map((option) => INSPECTION_LABEL[option])}
                value={INSPECTION_LABEL[inspection]}
                onChange={(e) => {
                  const found = INSPECTION_OPTIONS.find((option) => INSPECTION_LABEL[option] === e.target.value)
                  setInspection(found ?? 'nenhum')
                }}
                hint="A IA usa isso como argumento de segurança na negociação."
              />
              <Input
                label="Garantia (meses)"
                type="number"
                min={0}
                value={warrantyMonths}
                onChange={(e) => setWarrantyMonths(e.target.value)}
                placeholder="3"
                hint="Deixe vazio ou 0 se a loja não dá garantia própria."
              />
              <Input
                label="Detalhes da garantia"
                className="sm:col-span-2"
                value={warrantyDetails}
                onChange={(e) => setWarrantyDetails(e.target.value)}
                placeholder="Motor e câmbio, sem limite de quilometragem"
              />
            </div>
          </Section>

          <Section
            title="Bancos parceiros e formas de pagamento"
            hint="A IA cita estes bancos quando o cliente pergunta sobre financiamento e nunca inventa outros."
          >
            <Field label="Bancos parceiros">
              <div className="flex flex-wrap gap-2">
                {PARTNER_BANKS.map((bank) => (
                  <CheckPill
                    key={bank}
                    checked={banks.includes(bank)}
                    onChange={(checked) => setBanks(toggleIn(banks, bank, checked))}
                  >
                    {bank}
                  </CheckPill>
                ))}
              </div>
            </Field>
            <Field label="Formas de pagamento aceitas">
              <div className="flex flex-wrap gap-2">
                {PAYMENT_METHODS.map((method) => (
                  <CheckPill
                    key={method}
                    checked={payments.includes(method)}
                    onChange={(checked) => setPayments(toggleIn(payments, method, checked))}
                  >
                    {method}
                  </CheckPill>
                ))}
              </div>
            </Field>
          </Section>

          <Section
            title="Perfil do estoque"
            hint="Ajuda a IA a sugerir a alternativa mais próxima quando o cliente pede algo que a loja não tem."
          >
            <Field label="Categorias que a loja trabalha">
              <div className="flex flex-wrap gap-2">
                {VEHICLE_CATEGORIES.map((category) => (
                  <CheckPill
                    key={category}
                    checked={categories.includes(category)}
                    onChange={(checked) => setCategories(toggleIn(categories, category, checked))}
                  >
                    {category}
                  </CheckPill>
                ))}
              </div>
            </Field>
            <Field label="Condição dos veículos">
              <div className="flex flex-wrap gap-2">
                {VEHICLE_CONDITIONS.map((condition) => (
                  <CheckPill
                    key={condition}
                    checked={conditions.includes(condition)}
                    onChange={(checked) => setConditions(toggleIn(conditions, condition, checked))}
                  >
                    {condition}
                  </CheckPill>
                ))}
              </div>
            </Field>
          </Section>

          <Section
            title="Sobre a concessionária"
            hint="O que torna a loja diferente. A IA usa na fase de encantamento, com as suas palavras."
          >
            <Textarea
              value={differentials}
              onChange={(e) => setDifferentials(e.target.value)}
              placeholder="Há 12 anos no Batel, especializada em seminovos de baixa quilometragem. Todo carro sai revisado e com garantia."
              hint={`${differentials.length.toLocaleString('pt-BR')} caracteres.`}
            />
          </Section>

          <Section
            title="Regras importantes da loja"
            hint="O que a IA nunca pode fazer ou prometer, e o que ela deve sempre avisar. Estas instruções entram no atendimento sem alterar o texto base."
          >
            <Textarea
              value={serviceNotes}
              onChange={(e) => setServiceNotes(e.target.value)}
              placeholder="Nunca prometer desconto sem falar com o vendedor. Não negociamos por telefone. Aos domingos só atendemos com hora marcada."
              hint={`${serviceNotes.length.toLocaleString('pt-BR')} caracteres.`}
            />
          </Section>

          <Section
            title="Equipe"
            hint="Quem assume a conversa quando a IA transfere. O cadastro fica na etapa 3, “Central & vendedores”."
          >
            {salespeople.length === 0 ? (
              <InfoNote>
                Nenhum vendedor cadastrado ainda. Você faz isso na etapa 3 — sem pelo menos um, a IA não tem para quem
                transferir a conversa.
              </InfoNote>
            ) : (
              <ul className="divide-y divide-ink-100 overflow-hidden rounded-2xl border border-ink-100">
                {salespeople.map((person) => (
                  <li key={person.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <span className="text-sm font-semibold text-ink-900">{person.name}</span>
                    <span className="text-xs text-ink-500">
                      {person.role === 'administrator' ? 'Administrador' : 'Vendedor'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            title="Prompts da IA"
            hint="As três fases da conversa, lidas pelo fluxo do N8N. O texto base é o mesmo para toda a plataforma e não é editável aqui — ele se personaliza sozinho com os dados que você preencheu acima."
          >
            <div className="space-y-4">
              {AGENT_TYPES.map((type) => {
                const value = agents.find((agent) => agent.agent_type === type)?.system_prompt ?? ''
                return (
                  <Textarea
                    key={type}
                    label={AGENT_LABEL[type]}
                    readOnly
                    value={value}
                    className="bg-ink-50 text-ink-500"
                    hint={`${AGENT_HINT[type]} ${value.length.toLocaleString('pt-BR')} caracteres.`}
                  />
                )
              })}
            </div>
          </Section>

          {error && <InfoNote tone="red">{error}</InfoNote>}
        </div>
      </StepCard>
    </form>
  )
}
