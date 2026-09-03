import { useEffect, useState, type FormEvent } from 'react'
import { Modal } from '../../ui/Modal'
import { Button } from '../../ui/Button'
import { CheckPill, Field, Input, Select, Textarea, Toggle } from '../../ui/Field'
import {
  BODY_TYPES,
  CAR_STATUS_LABEL,
  FUELS,
  TRACTIONS,
  TRANSMISSIONS,
  type Car,
  type CarStatus,
} from '../../core/types'
import { PhotoPicker } from './PhotoPicker'
import type { CarDraft, PhotoItem } from './useCars'
import { BotaoFichaIA } from './BotaoFichaIA'

interface Props {
  open: boolean
  car: Car | null
  onClose: () => void
  onSave: (draft: CarDraft, photos: PhotoItem[], carId?: string) => Promise<unknown>
}

type FormState = Record<string, string> & { status: CarStatus }

const TEXT_FIELDS = [
  'brand', 'model', 'version', 'year', 'model_year', 'color', 'doors', 'transmission', 'body_type',
  'fuel', 'mileage_km', 'price_brl', 'engine', 'cylinders', 'horsepower', 'torque',
  'acceleration_0_100', 'aspiration', 'traction', 'air_conditioning', 'steering', 'electric_windows',
  'description',
] as const

const BOOL_FIELDS = ['ipva_paid', 'licensed', 'single_owner', 'dealer_revisions', 'accepts_trade'] as const

const EMPTY_TEXT = Object.fromEntries(TEXT_FIELDS.map((field) => [field, ''])) as Record<string, string>

const PROVENANCE: { key: (typeof BOOL_FIELDS)[number]; label: string }[] = [
  { key: 'single_owner', label: 'Único dono' },
  { key: 'dealer_revisions', label: 'Revisões em concessionária' },
  { key: 'ipva_paid', label: 'IPVA pago' },
  { key: 'licensed', label: 'Licenciado' },
]

const num = (value: string) => (value.trim() === '' ? null : Number(value.replace(/\./g, '').replace(',', '.')))
const text = (value: string) => (value.trim() === '' ? null : value.trim())

export function CarFormModal({ open, car, onClose, onSave }: Props) {
  const [form, setForm] = useState<FormState>({ ...EMPTY_TEXT, status: 'ativo' } as FormState)
  const [flags, setFlags] = useState<Record<string, boolean>>({ accepts_trade: true })
  const [photos, setPhotos] = useState<PhotoItem[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)

    if (car) {
      const next: Record<string, string> = {}
      for (const field of TEXT_FIELDS) {
        const value = car[field as keyof Car]
        next[field] = value === null || value === undefined ? '' : String(value)
      }
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
      year: num(form.year),
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
      ipva_paid: flag('ipva_paid'),
      licensed: flag('licensed'),
      single_owner: flag('single_owner'),
      dealer_revisions: flag('dealer_revisions'),
      accepts_trade: flag('accepts_trade'),
      description: text(form.description),
      status: form.status,
    }

    try {
      await onSave(draft, photos, car?.id)
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
          <h3 className="mb-3 text-sm font-bold text-ink-900">Identificação</h3>
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
            <Input label="Ano de fabricação" inputMode="numeric" value={form.year} onChange={(e) => set('year', e.target.value)} placeholder="2022" />
            <Input label="Ano do modelo" inputMode="numeric" value={form.model_year} onChange={(e) => set('model_year', e.target.value)} placeholder="2023" />
          </div>
        </section>

        <section>
          <BotaoFichaIA
            brand={form.brand}
            model={form.model}
            year={form.year}
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
            <Input label="Quilometragem" inputMode="numeric" value={form.mileage_km} onChange={(e) => set('mileage_km', e.target.value)} placeholder="45000" hint="Somente números" />
            <Input label="Cor" value={form.color} onChange={(e) => set('color', e.target.value)} placeholder="Prata" />
            <Input label="Portas" inputMode="numeric" value={form.doors} onChange={(e) => set('doors', e.target.value)} placeholder="4" />
            <Select label="Câmbio" options={TRANSMISSIONS} placeholder="Selecione" value={form.transmission} onChange={(e) => set('transmission', e.target.value)} />
            <Select label="Combustível" options={FUELS} placeholder="Selecione" value={form.fuel} onChange={(e) => set('fuel', e.target.value)} />
            <Select label="Carroceria" options={BODY_TYPES} placeholder="Selecione" value={form.body_type} onChange={(e) => set('body_type', e.target.value)} />
            <Input label="Motor" value={form.engine} onChange={(e) => set('engine', e.target.value)} placeholder="2.0 16V" />
            <Input label="Potência" value={form.horsepower} onChange={(e) => set('horsepower', e.target.value)} placeholder="177 cv" />
            <Select label="Tração" options={TRACTIONS} placeholder="Selecione" value={form.traction} onChange={(e) => set('traction', e.target.value)} />
          </div>

          <details className="group mt-4 rounded-2xl border border-ink-200 bg-ink-50/50 p-4">
            <summary className="cursor-pointer list-none text-sm font-semibold text-ink-700 marker:hidden">
              <span className="inline-flex items-center gap-2">
                <svg viewBox="0 0 20 20" className="size-4 transition-transform group-open:rotate-90" fill="none" aria-hidden="true">
                  <path d="m7.5 5 5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Mais detalhes técnicos (a IA usa na apresentação)
              </span>
            </summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Input label="Cilindros" value={form.cylinders} onChange={(e) => set('cylinders', e.target.value)} placeholder="4" />
              <Input label="Torque" value={form.torque} onChange={(e) => set('torque', e.target.value)} placeholder="21,4 kgfm" />
              <Input label="0 a 100 km/h" value={form.acceleration_0_100} onChange={(e) => set('acceleration_0_100', e.target.value)} placeholder="9,3 s" />
              <Input label="Aspiração" value={form.aspiration} onChange={(e) => set('aspiration', e.target.value)} placeholder="Turbo" />
              <Input label="Ar-condicionado" value={form.air_conditioning} onChange={(e) => set('air_conditioning', e.target.value)} placeholder="Digital dual zone" />
              <Input label="Direção" value={form.steering} onChange={(e) => set('steering', e.target.value)} placeholder="Elétrica" />
              <Input label="Vidros elétricos" value={form.electric_windows} onChange={(e) => set('electric_windows', e.target.value)} placeholder="Quatro portas" />
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
          <h3 className="mb-3 text-sm font-bold text-ink-900">Comercial</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Preço"
              prefix="R$"
              inputMode="decimal"
              value={form.price_brl}
              onChange={(e) => set('price_brl', e.target.value)}
              placeholder="129900"
            />
            <Field label="Status do anúncio">
              <div className="flex flex-wrap gap-2">
                {(Object.keys(CAR_STATUS_LABEL) as CarStatus[]).map((status) => (
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
