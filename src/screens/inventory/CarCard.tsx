import { motion } from 'framer-motion'
import type { Car } from '../../core/types'
import { formatBRL, formatKm, formatYear } from '../../core/format'
import { StatusBadge } from '../../ui/Feedback'
import { CarIcon, PencilIcon, TrashIcon } from '../../ui/icons'

interface Props {
  car: Car
  onEdit: (car: Car) => void
  onDelete: (car: Car) => void
}

export function CarCard({ car, onEdit, onDelete }: Props) {
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

          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => onEdit(car)}
              aria-label="Editar anúncio"
              className="grid size-9 place-items-center rounded-xl border border-ink-200 text-ink-500 transition-colors hover:border-brand-300 hover:text-brand-700"
            >
              <PencilIcon className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => onDelete(car)}
              aria-label="Excluir veículo"
              className="grid size-9 place-items-center rounded-xl border border-ink-200 text-ink-500 transition-colors hover:border-red-300 hover:text-red-600"
            >
              <TrashIcon className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </motion.article>
  )
}
