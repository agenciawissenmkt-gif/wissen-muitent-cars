import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Modal } from '../../ui/Modal'
import { Button } from '../../ui/Button'
import { CheckPill, Field, Input, Select, Textarea, Toggle } from '../../ui/Field'
import {
  BODY_TYPES,
  CAR_STATUS_LABEL,
  CARPLAY_OPTIONS,
  LAUDO_RESULTADO_LABEL,
  FUELS,
  PARKING_SENSORS,
  SUNROOFS,
  TRACTIONS,
  TRANSMISSIONS,
  YES_NO,
  type Car,
  type CarStatus,
  type LaudoResultado,
} from '../../core/types'
import { PhotoPicker } from './PhotoPicker'
import { subirLaudoPdf, type CarDraft, type LaudoPdf, type PhotoItem } from './useCars'
import { lerLaudo } from '../../core/api'
import { useTenant } from '../../core/tenant'
import { BotaoFichaIA } from './BotaoFichaIA'

interface Props {
  open: boolean
  car: Car | null
  onClose: () => void
  onSave: (draft: CarDraft, photos: PhotoItem[], carId?: string, laudoPdf?: LaudoPdf) => Promise<unknown>
  /** Excluir de vez (cadastro errado). Venda usa o botão Vendido do cartão. */
  onDelete?: (car: Car) => void
}

type FormState = Record<string, string> & { status: CarStatus }

// O cadastro pede so o ano do modelo; ao salvar, o mesmo valor vai para `year`,
// que e o ano que a busca e a Julia usam.
const TEXT_FIELDS = [
  'brand', 'model', 'version', 'model_year', 'color', 'doors', 'transmission', 'body_type',
  'fuel', 'mileage_km', 'price_brl', 'engine', 'cylinders', 'horsepower', 'torque',
  'acceleration_0_100', 'aspiration', 'traction', 'air_conditioning', 'steering', 'electric_windows',
  'sunroof', 'carplay_android_auto', 'trunk_liters', 'leather_seats', 'keyless_entry', 'parking_sensor',
  'rear_camera', 'description', 'laudo_resultado', 'laudo_empresa', 'laudo_data', 'laudo_obs',
] as const

const BOOL_FIELDS = ['ipva_paid', 'licensed', 'single_owner', 'dealer_revisions', 'accepts_trade'] as const

const EMPTY_TEXT = Object.fromEntries(TEXT_FIELDS.map((field) => [field, ''])) as Record<string, string>

const PROVENANCE: { key: (typeof BOOL_FIELDS)[number]; label: string }[] = [
  { key: 'single_owner', label: 'Único dono' },
  { key: 'dealer_revisions', label: 'Revisões em concessionária' },
  { key: 'ipva_paid', label: 'IPVA pago' },
  { key: 'licensed', label: 'Licenciado' },
]

const LAUDO_RESULTADOS = Object.keys(LAUDO_RESULTADO_LABEL) as LaudoResultado[]
const LAUDO_MAX_BYTES = 10 * 1024 * 1024

const num = (value: string) => (value.trim() === '' ? null : Number(value.replace(/\./g, '').replace(',', '.')))
const text = (value: string) => (value.trim() === '' ? null : value.trim())

export function CarFormModal({ open, car, onClose, onSave, onDelete }: Props) {
  const [form, setForm] = useState<FormState>({ ...EMPTY_TEXT, status: 'ativo' } as FormState)
  const [flags, setFlags] = useState<Record<string, boolean>>({ accepts_trade: true })
  const [photos, setPhotos] = useState<PhotoItem[]>([])
  const [laudoPdf, setLaudoPdf] = useState<LaudoPdf>({ kind: 'keep' })
  // Leitura do PDF do laudo pela IA (preenche empresa, data, resultado e apontamentos).
  const [lendoLaudo, setLendoLaudo] = useState(false)
  const [avisoLaudo, setAvisoLaudo] = useState<{ tom: 'ok' | 'erro'; texto: string } | null>(null)
  const leituraAtual = useRef(0)
  const formRef = useRef<Record<string, string>>({})
  const { store } = useTenant()
  const tenantId = store?.tenant_id ?? null
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setLaudoPdf({ kind: 'keep' })
    setAvisoLaudo(null)
    setLendoLaudo(false)
    leituraAtual.current++

    if (car) {
      const next: Record<string, string> = {}
      for (const field of TEXT_FIELDS) {
        const value = car[field as keyof Car]
        next[field] = value === null || value === undefined ? '' : String(value)
      }
      // Cadastro antigo com so o ano de fabricacao: mostra ele como ano do modelo.
      if (!next.model_year && car.year) next.model_year = String(car.year)
      setForm({ ...next, status: car.status } as FormState)
      setFlags(Object.fromEntries(BOOL_FIELDS.map((field) => [field, Boolean(car[field])])))
      setPhotos(
        car.car_photos.map((photo) => ({
          kind: 'existing' as const,
          id: photo.id,
          url: photo.url,
          storage_path: photo.storage_path,
        })),
      )
    } else {
      setForm({ ...EMPTY_TEXT, doors: '4', status: 'ativo' } as FormState)
      setFlags({ accepts_trade: true })
      setPhotos([])
    }
  }, [open, car])

  const set = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }))
  formRef.current = form

  /** PDF que vale agora: o novo escolhido, o que já estava salvo ou nenhum. */
  const pdfAtual =
    laudoPdf.kind === 'new'
      ? { nome: laudoPdf.file.name, url: null as string | null }
      : laudoPdf.kind === 'keep' && car?.laudo_pdf_url
        ? { nome: 'PDF do laudo', url: car.laudo_pdf_url }
        : null

  function escolheLaudo(file: File | undefined) {
    if (!file) return
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('O laudo precisa ser um arquivo PDF.')
      return
    }
    if (file.size > LAUDO_MAX_BYTES) {
      setError('O PDF do laudo passa de 10 MB. Gere um arquivo menor e tente de novo.')
      return
    }
    setError(null)
    setLaudoPdf({ kind: 'new', file })
    void lerPdfDoLaudo(file)
  }

  /**
   * Sobe o PDF na hora e pede para a IA ler. So preenche o campo que ainda esta
   * vazio -- o que a loja ja digitou fica como esta. Resultado so vem quando o
   * documento traz o parecer; consulta veicular sem parecer fica para a loja escolher.
   */
  async function lerPdfDoLaudo(file: File) {
    if (!tenantId) return
    const minha = ++leituraAtual.current
    setLendoLaudo(true)
    setAvisoLaudo(null)
    try {
      const enviado = await subirLaudoPdf(tenantId, file)
      if (leituraAtual.current !== minha) return
      setLaudoPdf({ kind: 'new', file, enviado })

      const { leitura } = await lerLaudo({ tenant_id: tenantId, pdf_url: enviado.url })
      if (leituraAtual.current !== minha) return

      const atual = formRef.current
      const novos: Record<string, string> = {}
      const preenchidos: string[] = []
      const mantidos: string[] = []
      const tenta = (campo: string, valor: string | null, nome: string) => {
        if (!valor) return
        if ((atual[campo] ?? '').trim()) {
          if ((atual[campo] ?? '').trim() !== valor) mantidos.push(nome)
          return
        }
        novos[campo] = valor
        preenchidos.push(nome)
      }
      tenta('laudo_resultado', leitura.resultado, 'resultado')
      tenta('laudo_empresa', leitura.empresa, 'empresa')
      tenta('laudo_data', leitura.data, 'data')
      tenta('laudo_obs', leitura.apontamentos, 'apontamentos')
      if (Object.keys(novos).length) setForm((prev) => ({ ...prev, ...novos }))

      const partes: string[] = []
      if (preenchidos.length) partes.push(`Preenchi pelo PDF: ${preenchidos.join(', ')}.`)
      if (!leitura.resultado && !(atual.laudo_resultado ?? '').trim()) {
        partes.push(
          leitura.tipo_documento === 'consulta_veicular'
            ? 'É uma consulta veicular, sem parecer final: escolha o resultado você.'
            : 'O PDF não traz o resultado: escolha você.',
        )
      }
      if (mantidos.length) partes.push(`Mantive o que você já tinha preenchido em: ${mantidos.join(', ')}.`)
      if (!preenchidos.length && !partes.length) partes.push('Não achei empresa, data nem resultado escritos no PDF. Preencha à mão.')
      partes.push('Confira antes de salvar.')
      setAvisoLaudo({ tom: 'ok', texto: partes.join(' ') })
    } catch (e) {
      if (leituraAtual.current !== minha) return
      const motivo = e instanceof Error ? e.message : ''
      setAvisoLaudo({
        tom: 'erro',
        texto: `${motivo || 'Não consegui ler o PDF agora.'} O PDF continua anexado; preencha os campos à mão se precisar.`,
      })
    } finally {
      if (leituraAtual.current === minha) setLendoLaudo(false)
    }
  }
  const flag = (key: string) => Boolean(flags[key])
  const setFlag = (key: string, value: boolean) => setFlags((prev) => ({ ...prev, [key]: value }))

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!form.model.trim()) {
      setError('Informe pelo menos o modelo do veículo.')
      return
    }

    setSaving(true)
    setError(null)

    const draft: CarDraft = {
      brand: text(form.brand),
      model: form.model.trim(),
      version: text(form.version),
      year: num(form.model_year),
      model_year: num(form.model_year),
      color: text(form.color),
      doors: num(form.doors),
      transmission: text(form.transmission),
      body_type: text(form.body_type),
      fuel: text(form.fuel),
      mileage_km: num(form.mileage_km),
      price_brl: num(form.price_brl),
      engine: text(form.engine),
      cylinders: text(form.cylinders),
      horsepower: text(form.horsepower),
      torque: text(form.torque),
      acceleration_0_100: text(form.acceleration_0_100),
      aspiration: text(form.aspiration),
      traction: text(form.traction),
      air_conditioning: text(form.air_conditioning),
      steering: text(form.steering),
      electric_windows: text(form.electric_windows),
      sunroof: text(form.sunroof),
      carplay_android_auto: text(form.carplay_android_auto),
      trunk_liters: num(form.trunk_liters),
      leather_seats: text(form.leather_seats),
      keyless_entry: text(form.keyless_entry),
      parking_sensor: text(form.parking_sensor),
      rear_camera: text(form.rear_camera),
      ipva_paid: flag('ipva_paid'),
      licensed: flag('licensed'),
      single_owner: flag('single_owner'),
      dealer_revisions: flag('dealer_revisions'),
      accepts_trade: flag('accepts_trade'),
      description: text(form.description),
      status: form.status,
      laudo_resultado: (LAUDO_RESULTADOS as string[]).includes(form.laudo_resultado)
        ? (form.laudo_resultado as LaudoResultado)
        : null,
      laudo_empresa: text(form.laudo_empresa),
      laudo_data: text(form.laudo_data),
      laudo_obs: text(form.laudo_obs),
    }

    try {
      await onSave(draft, photos, car?.id, laudoPdf)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar o veículo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={car ? 'Editar anúncio' : 'Cadastrar veículo'}
      subtitle={
        car
          ? 'As alterações ficam disponíveis para a IA imediatamente.'
          : 'Os dados preenchidos aqui alimentam o agente de IA no WhatsApp.'
      }
      footer={
        <>
          {car && onDelete && (
            <button type="button" onClick={() => onDelete(car)} disabled={saving} className="mr-auto text-sm font-semibold text-red-600 hover:underline">
              Excluir anúncio
            </button>
          )}
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" form="car-form" loading={saving}>
            {car ? 'Salvar alterações' : 'Cadastrar veículo'}
          </Button>
        </>
      }
    >
      <form id="car-form" onSubmit={handleSubmit} className="space-y-8">
        <section>
          <h3 className="mb-3 text-sm font-bold text-ink-900">Fotos do veículo</h3>
          <PhotoPicker photos={photos} onChange={setPhotos} />
        </section>

        <section>
          <h3 className="mb-1 text-sm font-bold text-ink-900">Identificação</h3>
          <p className="mb-3 text-xs text-ink-500">Dados deste carro. Preenchidos por você, a IA não mexe aqui.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Marca" value={form.brand} onChange={(e) => set('brand', e.target.value)} placeholder="Toyota" />
            <Input label="Modelo" required value={form.model} onChange={(e) => set('model', e.target.value)} placeholder="Corolla" />
            <Input
              label="Versão"
              className="sm:col-span-2"
              value={form.version}
              onChange={(e) => set('version', e.target.value)}
              placeholder="XEi 2.0 Flex 16V Aut."
            />
            <Input label="Ano do modelo" inputMode="numeric" value={form.model_year} onChange={(e) => set('model_year', e.target.value)} placeholder="2023" />
            <Input label="Cor" value={form.color} onChange={(e) => set('color', e.target.value)} placeholder="Prata" />
            <Input label="Quilometragem" inputMode="numeric" value={form.mileage_km} onChange={(e) => set('mileage_km', e.target.value)} placeholder="45000" hint="Somente números" />
            <Input
              label="Preço"
              prefix="R$"
              inputMode="decimal"
              value={form.price_brl}
              onChange={(e) => set('price_brl', e.target.value)}
              placeholder="129900"
            />
          </div>
        </section>

        <section>
          <BotaoFichaIA
            brand={form.brand}
            model={form.model}
            modelYear={form.model_year}
            version={form.version}
            onPreencher={(ficha) =>
              setForm((atual) => ({
                ...atual,
                ...Object.fromEntries(Object.entries(ficha).map(([campo, valor]) => [campo, String(valor)])),
              }))
            }
          />
          <h3 className="mb-3 text-sm font-bold text-ink-900">Ficha técnica</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Input label="Motor" value={form.engine} onChange={(e) => set('engine', e.target.value)} placeholder="2.0 16V" />
            <Input label="Potência" value={form.horsepower} onChange={(e) => set('horsepower', e.target.value)} placeholder="177 cv" />
            <Input label="Torque" value={form.torque} onChange={(e) => set('torque', e.target.value)} placeholder="21,4 kgfm" />
            <Input label="0 a 100 km/h" value={form.acceleration_0_100} onChange={(e) => set('acceleration_0_100', e.target.value)} placeholder="9,3 s" />
            <Select label="Câmbio" options={TRANSMISSIONS} placeholder="Selecione" value={form.transmission} onChange={(e) => set('transmission', e.target.value)} />
            <Select label="Combustível" options={FUELS} placeholder="Selecione" value={form.fuel} onChange={(e) => set('fuel', e.target.value)} />
            <Select label="Carroceria" options={BODY_TYPES} placeholder="Selecione" value={form.body_type} onChange={(e) => set('body_type', e.target.value)} />
            <Select label="Tração" options={TRACTIONS} placeholder="Selecione" value={form.traction} onChange={(e) => set('traction', e.target.value)} />
            <Input label="Portas" inputMode="numeric" value={form.doors} onChange={(e) => set('doors', e.target.value)} placeholder="4" />
            <Input label="Porta-malas" inputMode="numeric" value={form.trunk_liters} onChange={(e) => set('trunk_liters', e.target.value)} placeholder="470" hint="Em litros" />
          </div>

          <h3 className="mb-3 mt-6 text-sm font-bold text-ink-900">Conforto e tecnologia</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Select label="Teto solar" options={SUNROOFS} placeholder="Selecione" value={form.sunroof} onChange={(e) => set('sunroof', e.target.value)} />
            <Select label="CarPlay / Android Auto" options={CARPLAY_OPTIONS} placeholder="Selecione" value={form.carplay_android_auto} onChange={(e) => set('carplay_android_auto', e.target.value)} />
            <Select label="Banco de couro" options={YES_NO} placeholder="Selecione" value={form.leather_seats} onChange={(e) => set('leather_seats', e.target.value)} />
            <Select label="Chave presencial" options={YES_NO} placeholder="Selecione" value={form.keyless_entry} onChange={(e) => set('keyless_entry', e.target.value)} />
            <Select label="Sensor de estacionamento" options={PARKING_SENSORS} placeholder="Selecione" value={form.parking_sensor} onChange={(e) => set('parking_sensor', e.target.value)} />
            <Select label="Câmera de ré" options={YES_NO} placeholder="Selecione" value={form.rear_camera} onChange={(e) => set('rear_camera', e.target.value)} />
            <Input label="Ar-condicionado" value={form.air_conditioning} onChange={(e) => set('air_conditioning', e.target.value)} placeholder="Dual zone" />
            <Input label="Direção" value={form.steering} onChange={(e) => set('steering', e.target.value)} placeholder="Elétrica" />
            <Input label="Vidros elétricos" value={form.electric_windows} onChange={(e) => set('electric_windows', e.target.value)} placeholder="4 portas" />
          </div>

          <details className="group mt-4 rounded-2xl border border-ink-200 bg-ink-50/50 p-4">
            <summary className="cursor-pointer list-none text-sm font-semibold text-ink-700 marker:hidden">
              <span className="inline-flex items-center gap-2">
                <svg viewBox="0 0 20 20" className="size-4 transition-transform group-open:rotate-90" fill="none" aria-hidden="true">
                  <path d="m7.5 5 5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Mais detalhes do motor
              </span>
            </summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Input label="Cilindros" value={form.cylinders} onChange={(e) => set('cylinders', e.target.value)} placeholder="4 cilindros" />
              <Input label="Aspiração" value={form.aspiration} onChange={(e) => set('aspiration', e.target.value)} placeholder="Turbo" />
            </div>
          </details>
        </section>

        <section>
          <h3 className="mb-3 text-sm font-bold text-ink-900">Procedência</h3>
          <div className="flex flex-wrap gap-2">
            {PROVENANCE.map((item) => (
              <CheckPill key={item.key} checked={flag(item.key)} onChange={(value) => setFlag(item.key, value)}>
                {item.label}
              </CheckPill>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-1 text-sm font-bold text-ink-900">Laudo cautelar deste carro</h3>
          <p className="mb-3 text-xs text-ink-500">
            A Júlia fala do laudo deste carro e envia o PDF quando o cliente pedir. Sem laudo aqui, ela usa a regra
            geral da loja. Ao enviar o PDF, a IA lê o documento e preenche os campos vazios para você conferir.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Resultado"
              options={LAUDO_RESULTADOS.map((resultado) => LAUDO_RESULTADO_LABEL[resultado])}
              placeholder="Sem laudo cadastrado"
              value={
                (LAUDO_RESULTADOS as string[]).includes(form.laudo_resultado)
                  ? LAUDO_RESULTADO_LABEL[form.laudo_resultado as LaudoResultado]
                  : ''
              }
              onChange={(e) =>
                set('laudo_resultado', LAUDO_RESULTADOS.find((r) => LAUDO_RESULTADO_LABEL[r] === e.target.value) ?? '')
              }
            />
            <Input
              label="Empresa do laudo"
              value={form.laudo_empresa}
              onChange={(e) => set('laudo_empresa', e.target.value)}
              placeholder="Dekra, Supervisão, Tüv..."
            />
            <Input label="Data do laudo" type="date" value={form.laudo_data} onChange={(e) => set('laudo_data', e.target.value)} />
            <Field label="PDF do laudo">
              <div className="flex flex-wrap items-center gap-2">
                {pdfAtual ? (
                  pdfAtual.url ? (
                    <a
                      href={pdfAtual.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-semibold text-brand-700 hover:underline"
                    >
                      {pdfAtual.nome}
                    </a>
                  ) : (
                    <span className="max-w-[14rem] truncate text-sm font-semibold text-ink-900">{pdfAtual.nome}</span>
                  )
                ) : (
                  <span className="text-sm text-ink-400">Nenhum PDF</span>
                )}
                <label className="cursor-pointer rounded-xl border border-ink-200 bg-white px-3 py-2 text-xs font-semibold text-ink-700 hover:border-brand-300">
                  {pdfAtual ? 'Trocar' : 'Enviar PDF'}
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    className="hidden"
                    onChange={(e) => {
                      escolheLaudo(e.target.files?.[0])
                      e.target.value = ''
                    }}
                  />
                </label>
                {pdfAtual && (
                  <button
                    type="button"
                    onClick={() => {
                      leituraAtual.current++
                      setLendoLaudo(false)
                      setAvisoLaudo(null)
                      setLaudoPdf(car?.laudo_pdf_url ? { kind: 'remove' } : { kind: 'keep' })
                    }}
                    className="text-xs font-semibold text-red-600 hover:underline"
                  >
                    Remover
                  </button>
                )}
              </div>
            </Field>
            {(lendoLaudo || avisoLaudo) && (
              <p
                className={`sm:col-span-2 rounded-2xl px-4 py-3 text-xs ${
                  lendoLaudo
                    ? 'bg-brand-50 text-brand-700'
                    : avisoLaudo?.tom === 'erro'
                      ? 'bg-red-50 text-red-700'
                      : 'bg-emerald-50 text-emerald-800'
                }`}
              >
                {lendoLaudo ? 'Lendo o PDF do laudo para preencher os campos...' : avisoLaudo?.texto}
              </p>
            )}
            <div className="sm:col-span-2">
              <Textarea
                label="Apontamentos"
                value={form.laudo_obs}
                onChange={(e) => set('laudo_obs', e.target.value)}
                placeholder="Ex.: reparo no para-choque traseiro, sem dano estrutural."
                hint="O que o laudo apontou. A Júlia fala disso com honestidade e passa os detalhes ao consultor."
              />
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-3 text-sm font-bold text-ink-900">Comercial</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Status do anúncio" className="sm:col-span-2">
              <div className="flex flex-wrap gap-2">
                {(Object.keys(CAR_STATUS_LABEL) as CarStatus[]).filter((status) => status !== 'vendido').map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setForm((prev) => ({ ...prev, status }))}
                    className={`rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all ${
                      form.status === status
                        ? 'border-brand-600 bg-brand-600 text-white'
                        : 'border-ink-200 bg-white text-ink-700 hover:border-brand-300'
                    }`}
                  >
                    {CAR_STATUS_LABEL[status]}
                  </button>
                ))}
              </div>
            </Field>
            <div className="sm:col-span-2">
              <Toggle
                checked={flag('accepts_trade')}
                onChange={(value) => setFlag('accepts_trade', value)}
                label="Aceita troca neste veículo"
                description="A IA vai oferecer avaliação do carro usado do cliente."
              />
            </div>
            <Textarea
              label="Descrição e opcionais"
              className="sm:col-span-2"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="Multimídia, câmera de ré, sensor de estacionamento, bancos em couro..."
              hint="Quanto mais detalhes, melhor o agente de IA apresenta o veículo."
            />
          </div>
        </section>

        {error && <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      </form>
    </Modal>
  )
}
