import { motion } from 'framer-motion'
import type { Car } from '../../core/types'
import { formatBRL, formatKm, formatYear } from '../../core/format'
import { StatusBadge } from '../../ui/Feedback'
import { CarIcon, CheckIcon, MoneyIcon, PencilIcon } from '../../ui/icons'

interface Props {
  car: Car
  onEdit: (car: Car) => void
  /** Pede confirmação e tira o carro do painel e da IA. */
  onSold: (car: Car) => void
  /** Cliente deu sinal: tira da IA; clicar de novo volta para Disponível. */
  onDeposit: (car: Car) => void
  busy?: boolean
}

export function CarCard({ car, onEdit, onSold, onDeposit, busy = false }: Props) {
  const withDeposit = car.status === 'reservado'
  const cover = car.car_photos[0]?.url ?? car.cover_url

  const specs = [
    formatYear(car.year, car.model_year),
    formatKm(car.mileage_km),
    car.transmission,
    car.fuel,
    car.color,
  ].filter(Boolean) as string[]

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="group flex flex-col overflow-hidden rounded-3xl border border-ink-100 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-ink-900/5"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-ink-100">
        {cover ? (
          <img
            src={cover}
            alt={[car.brand, car.model].filter(Boolean).join(' ')}
            loading="lazy"
            className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="grid size-full place-items-center text-ink-400">
            <CarIcon className="size-10" />
          </div>
        )}

        <span className="absolute left-3 top-3">
          <StatusBadge status={car.status} />
        </span>

        {car.car_photos.length > 1 && (
          <span className="absolute bottom-3 right-3 rounded-full bg-ink-900/70 px-2.5 py-1 text-[0.65rem] font-bold text-white backdrop-blur">
            {car.car_photos.length} fotos
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-5">
        <h3 className="text-base font-bold leading-snug text-ink-900">
          {[car.brand, car.model].filter(Boolean).join(' ')}
        </h3>
        {car.version && <p className="mt-0.5 line-clamp-1 text-sm text-ink-500">{car.version}</p>}

        <ul className="mt-3 flex flex-wrap gap-1.5">
          {specs.map((spec) => (
            <li key={spec} className="rounded-lg bg-ink-100 px-2 py-1 text-[0.7rem] font-semibold text-ink-700">
              {spec}
            </li>
          ))}
        </ul>

        <div className="mt-auto flex items-end justify-between gap-3 pt-5">
          <div>
            <span className="block text-xs font-medium text-ink-400">Preço</span>
            <span className="block text-xl font-extrabold text-brand-700">{formatBRL(car.price_brl)}</span>
            {/* espaço reservado mesmo sem troca, para alinhar os cards da grade */}
            <span className="block h-4 text-[0.7rem] font-semibold text-emerald-600">
              {car.accepts_trade ? 'Aceita troca' : ''}
            </span>
          </div>

          <button
            type="button"
            onClick={() => onEdit(car)}
            aria-label="Editar anúncio"
            className="grid size-9 place-items-center rounded-xl border border-ink-200 text-ink-500 transition-colors hover:border-brand-300 hover:text-brand-700"
          >
            <PencilIcon className="size-4" />
          </button>
        </div>

        {withDeposit && (
          <p className="mt-3 rounded-xl bg-blue-50 px-3 py-2 text-xs font-medium text-blue-900">
            Fora da IA enquanto o sinal estiver ativo. Se o cliente desistir, toque em <strong>Retomar venda</strong>.
          </p>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onDeposit(car)}
            className={`inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-2 text-[0.8rem] font-bold transition-all active:scale-[0.98] disabled:opacity-50 ${
              withDeposit
                ? 'border-2 border-blue-900 bg-white text-blue-900 hover:bg-blue-50'
                : 'bg-blue-900 text-white shadow-md shadow-blue-900/25 hover:bg-blue-950'
            }`}
          >
            {!withDeposit && <MoneyIcon className="size-4 shrink-0" />}
            {withDeposit ? 'Retomar venda' : 'Deu sinal'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onSold(car)}
            className="inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-emerald-600 px-2 text-[0.8rem] font-bold text-white shadow-md shadow-emerald-600/25 transition-all hover:bg-emerald-700 active:scale-[0.98] disabled:opacity-50"
          >
            <CheckIcon className="size-4" />
            Vendido
          </button>
        </div>
      </div>
    </motion.article>
  )
}
