import { useEffect, useState } from 'react'
import { useTenant } from '../../core/tenant'
import { ApiError, googleAuthUrl, googleDisconnect } from '../../core/api'
import { Button } from '../../ui/Button'
import { useToast } from '../../ui/Feedback'
import { CalendarIcon, CheckIcon, GoogleIcon } from '../../ui/icons'
import { InfoNote, StepCard } from './StepCard'

const PERMISSIONS = [
  'Ler os horários já ocupados da agenda da loja',
  'Criar eventos de visita e test-drive com os dados do cliente',
  'Remarcar e cancelar agendamentos quando o cliente pedir',
]

export function StepCalendar({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const { store, settings, google, refresh } = useTenant()
  const tenant = store?.tenant_id ? { id: store.tenant_id } : null
  const connected = google ?? (settings?.google_calendar_id ? { email: null, calendar_id: settings.google_calendar_id } : null)
  const { toast } = useToast()
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null)

  // O popup de OAuth avisa a janela principal quando o consentimento termina.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return
      if (event.data?.type !== 'wissen:google') return
      setConnecting(false)
      if (event.data.ok) {
        void refresh()
        toast('Google Agenda conectado com sucesso.')
      } else {
        setError({ message: String(event.data.error ?? 'Não foi possível concluir a autorização.') })
      }
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [refresh, toast])

  async function connect() {
    if (!tenant) return
    setConnecting(true)
    setError(null)
    try {
      const { url } = await googleAuthUrl(tenant.id)
      const popup = window.open(url, 'wissen-google', 'width=520,height=680')
      if (!popup) {
        setConnecting(false)
        setError({ message: 'O navegador bloqueou a janela de autorização. Libere os pop-ups e tente novamente.' })
      }
    } catch (err) {
      setConnecting(false)
      setError(
        err instanceof ApiError
          ? { message: err.message, hint: err.hint }
          : { message: 'Não foi possível iniciar a conexão com o Google.' },
      )
    }
  }

  async function disconnect() {
    if (!tenant) return
    try {
      await googleDisconnect(tenant.id)
      await refresh()
      toast('Agenda desconectada.', 'info')
    } catch (err) {
      setError({ message: err instanceof Error ? err.message : 'Falha ao desconectar.' })
    }
  }

  return (
    <StepCard
      title="Conectar o Google Agenda"
      description="Com um clique a IA passa a marcar visitas e test-drives direto na agenda da loja."
      footer={
        <>
          <Button variant="ghost" onClick={onBack}>
            Voltar
          </Button>
          <Button onClick={onNext} variant={connected ? 'primary' : 'secondary'}>
            {connected ? 'Continuar' : 'Pular por enquanto'}
          </Button>
        </>
      }
    >
      {connected ? (
        <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6">
          <span className="grid size-12 place-items-center rounded-2xl bg-emerald-500 text-white">
            <CheckIcon className="size-6" />
          </span>
          <h3 className="mt-4 text-base font-bold text-emerald-900">Agenda conectada</h3>
          <p className="mt-1 text-sm text-emerald-800">
            Conta <strong>{connected.email ?? 'Google'}</strong> · calendário{' '}
            <code className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-xs">{connected.calendar_id}</code>
          </p>
          <Button variant="secondary" size="sm" className="mt-5" onClick={() => void disconnect()}>
            Desconectar
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-col items-start gap-5 rounded-3xl border border-ink-200 bg-ink-50/60 p-6 sm:flex-row sm:items-center">
            <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-white text-brand-600 shadow-sm">
              <CalendarIcon className="size-7" />
            </span>
            <div className="flex-1">
              <h3 className="text-base font-bold text-ink-900">Autorize o acesso à agenda</h3>
              <p className="mt-1 text-sm text-ink-500">
                Você será levado à tela de consentimento do Google. Nada é publicado na sua agenda sem uma solicitação
                real de cliente.
              </p>
            </div>
            <Button onClick={() => void connect()} loading={connecting} icon={connecting ? undefined : <GoogleIcon />}>
              Conectar Google Agenda
            </Button>
          </div>

          <ul className="space-y-2">
            {PERMISSIONS.map((permission) => (
              <li key={permission} className="flex items-start gap-3 text-sm text-ink-600">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-brand-100 text-brand-700">
                  <CheckIcon className="size-3.5" />
                </span>
                {permission}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <div className="mt-6 space-y-2">
          <InfoNote tone="red">{error.message}</InfoNote>
          {error.hint && <InfoNote tone="amber">{error.hint}</InfoNote>}
        </div>
      )}
    </StepCard>
  )
}
