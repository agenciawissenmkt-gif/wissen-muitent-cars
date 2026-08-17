import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useTenant } from '../core/tenant'
import { ONBOARDING_TO_STEP, STEP_TO_ONBOARDING } from '../core/types'
import { CalendarIcon, ChatIcon, SettingsIcon, WhatsappIcon } from '../ui/icons'
import { StepRules } from './implementation/StepRules'
import { StepCalendar } from './implementation/StepCalendar'
import { StepChatwoot } from './implementation/StepChatwoot'
import { StepWhatsapp } from './implementation/StepWhatsapp'

const STEPS = [
  { number: 1, title: 'Regras da loja & IA', short: 'Regras', icon: <SettingsIcon className="size-4" /> },
  { number: 2, title: 'Google Agenda', short: 'Agenda', icon: <CalendarIcon className="size-4" /> },
  { number: 3, title: 'Central & vendedores', short: 'Central', icon: <ChatIcon className="size-4" /> },
  { number: 4, title: 'Conexão WhatsApp', short: 'WhatsApp', icon: <WhatsappIcon className="size-4" /> },
]

export function Implementation() {
  const { store, updateStore } = useTenant()
  const [step, setStep] = useState(1)
  const [maxVisited, setMaxVisited] = useState(1)

  useEffect(() => {
    if (!store) return
    const saved = store.onboarding_step === 'concluido' ? 4 : ONBOARDING_TO_STEP[store.onboarding_step] ?? 1
    setStep(saved)
    setMaxVisited(store.onboarding_step === 'concluido' ? 4 : saved)
  }, [store?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function goTo(next: number) {
    const target = Math.min(Math.max(next, 1), 4)
    setStep(target)
    setMaxVisited((prev) => Math.max(prev, target))

    const current = store ? ONBOARDING_TO_STEP[store.onboarding_step] ?? 1 : 1
    if (store && store.onboarding_step !== 'concluido' && target > current) {
      try {
        await updateStore({ onboarding_step: STEP_TO_ONBOARDING[target] })
      } catch {
        /* a navegação não deve travar se o salvamento do progresso falhar */
      }
    }
  }

  const progress = ((step - 1) / (STEPS.length - 1)) * 100

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8">
      <header>
        <h1 className="text-2xl font-extrabold text-ink-900 sm:text-3xl">Implementação da Loja</h1>
        <p className="mt-1 text-sm text-ink-500">
          Quatro etapas para deixar seu agente de IA atendendo no WhatsApp.
        </p>
      </header>

      <div className="relative mt-8">
        <div className="absolute left-0 top-5 h-0.5 w-full rounded-full bg-ink-200" />
        <motion.div
          className="absolute left-0 top-5 h-0.5 rounded-full bg-brand-600"
          initial={false}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.4 }}
        />
        <ol className="relative flex justify-between">
          {STEPS.map((item) => {
            const done = item.number < step
            const active = item.number === step
            const reachable = item.number <= maxVisited

            return (
              <li key={item.number} className="flex flex-col items-center gap-2">
                <button
                  type="button"
                  disabled={!reachable}
                  onClick={() => void goTo(item.number)}
                  className={`grid size-10 place-items-center rounded-full border-2 text-sm font-bold transition-all ${
                    active
                      ? 'border-brand-600 bg-brand-600 text-white shadow-lg shadow-brand-600/25'
                      : done
                        ? 'border-emerald-500 bg-emerald-500 text-white'
                        : 'border-ink-200 bg-white text-ink-400'
                  } ${reachable ? 'cursor-pointer' : 'cursor-not-allowed'}`}
                  aria-current={active ? 'step' : undefined}
                >
                  {done ? (
                    <svg viewBox="0 0 20 20" className="size-4" fill="none" aria-hidden="true">
                      <path d="m4 10.5 4 4 8-9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    item.number
                  )}
                </button>
                <span className={`hidden text-xs font-semibold sm:block ${active ? 'text-brand-700' : 'text-ink-400'}`}>
                  {item.short}
                </span>
              </li>
            )
          })}
        </ol>
      </div>

      <div className="mt-8">
        <div className="mb-5 flex items-center gap-2 text-sm font-bold text-brand-700">
          {STEPS[step - 1].icon}
          Etapa {step} de 4 — {STEPS[step - 1].title}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.25 }}
          >
            {step === 1 && <StepRules onNext={() => void goTo(2)} />}
            {step === 2 && <StepCalendar onNext={() => void goTo(3)} onBack={() => void goTo(1)} />}
            {step === 3 && <StepChatwoot onNext={() => void goTo(4)} onBack={() => void goTo(2)} />}
            {step === 4 && <StepWhatsapp onBack={() => void goTo(3)} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
