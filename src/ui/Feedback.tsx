import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { CarStatus } from '../core/types'
import { CAR_STATUS_LABEL } from '../core/types'

// --- Badge de status do veículo --------------------------------------------

const STATUS_STYLE: Record<CarStatus, string> = {
  ativo: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  reservado: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  vendido: 'bg-ink-100 text-ink-500 ring-ink-500/20',
}

export function StatusBadge({ status }: { status: CarStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ring-1 ring-inset ${STATUS_STYLE[status]}`}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {CAR_STATUS_LABEL[status]}
    </span>
  )
}

// --- Toasts -----------------------------------------------------------------

type ToastKind = 'success' | 'error' | 'info'

interface Toast {
  id: number
  kind: ToastKind
  message: string
}

interface ToastValue {
  toast: (message: string, kind?: ToastKind) => void
}

const ToastContext = createContext<ToastValue | null>(null)

const TOAST_STYLE: Record<ToastKind, string> = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  error: 'border-red-200 bg-red-50 text-red-800',
  info: 'border-brand-200 bg-brand-50 text-brand-800',
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const toast = useCallback((message: string, kind: ToastKind = 'success') => {
    const id = Date.now() + Math.random()
    setToasts((prev) => [...prev, { id, kind, message }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000)
  }, [])

  const value = useMemo(() => ({ toast }), [toast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex flex-col items-center gap-2 px-4">
        <AnimatePresence>
          {toasts.map((item) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 20, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.96 }}
              className={`pointer-events-auto max-w-md rounded-2xl border px-5 py-3 text-sm font-medium shadow-lg ${TOAST_STYLE[item.kind]}`}
            >
              {item.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast precisa estar dentro de <ToastProvider>')
  return ctx
}

// --- Estados vazios / carregando -------------------------------------------

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-ink-200 bg-ink-50/50 px-6 py-16 text-center">
      {icon && <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-white text-brand-600 shadow-sm">{icon}</div>}
      <h3 className="text-base font-bold text-ink-900">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm text-ink-500">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}

export function SkeletonCard() {
  return (
    <div className="overflow-hidden rounded-3xl border border-ink-100 bg-white">
      <div className="aspect-[4/3] animate-pulse bg-ink-100" />
      <div className="space-y-3 p-5">
        <div className="h-4 w-2/3 animate-pulse rounded-full bg-ink-100" />
        <div className="h-3 w-1/2 animate-pulse rounded-full bg-ink-100" />
        <div className="h-6 w-1/3 animate-pulse rounded-full bg-ink-100" />
      </div>
    </div>
  )
}
