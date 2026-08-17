import type { ReactNode } from 'react'

export function StepCard({
  title,
  description,
  children,
  footer,
}: {
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-3xl border border-ink-100 bg-white shadow-sm">
      <div className="border-b border-ink-100 px-6 py-5">
        <h2 className="text-lg font-bold text-ink-900">{title}</h2>
        {description && <p className="mt-1 text-sm leading-relaxed text-ink-500">{description}</p>}
      </div>
      <div className="px-6 py-6">{children}</div>
      {footer && (
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-ink-100 bg-ink-50/60 px-6 py-4">
          {footer}
        </div>
      )}
    </section>
  )
}

export function InfoNote({ children, tone = 'brand' }: { children: ReactNode; tone?: 'brand' | 'amber' | 'red' }) {
  const styles = {
    brand: 'border-brand-200 bg-brand-50 text-brand-800',
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    red: 'border-red-200 bg-red-50 text-red-700',
  }
  return <p className={`rounded-2xl border px-4 py-3 text-sm leading-relaxed ${styles[tone]}`}>{children}</p>
}
