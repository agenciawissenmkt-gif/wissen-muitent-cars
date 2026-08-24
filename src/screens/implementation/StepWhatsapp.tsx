import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { useTenant } from '../../core/tenant'
import {
  ApiError,
  completeProvisioning,
  createWhatsappInstance,
  disconnectWhatsapp,
  provisionChatwoot,
  whatsappState,
  type EvolutionState,
} from '../../core/api'
import { celebrate } from '../../core/celebrate'
import { maskPhone, onlyDigits, toWhatsappNumber } from '../../core/format'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Field'
import { useToast } from '../../ui/Feedback'
import { CheckIcon, WhatsappIcon } from '../../ui/icons'
import { InfoNote, StepCard } from './StepCard'

// 3 s era agressivo demais: cada ciclo batia em /state e /state pedia connect,
// o que abria um socket novo do Baileys a cada volta. Com /state agora sendo
// leitura pura, 5 s é folgado e ainda parece instantâneo para o lojista.
const POLL_INTERVAL = 5000

const INSTRUCTIONS = [
  'Abra o WhatsApp no celular que vai atender os clientes.',
  'Toque em Configurações › Dispositivos conectados › Conectar dispositivo.',
  'Aponte a câmera para o QR Code ao lado.',
]

export function StepWhatsapp({ onBack }: { onBack: () => void }) {
  const { store, settings, channel, updateStore, updateSettings, refresh } = useTenant()
  const { toast } = useToast()

  const tenantId = store?.tenant_id ?? null
  const savedNumber = channel?.whatsapp_number ?? settings?.bot_phone ?? ''

  const [phone, setPhone] = useState(savedNumber ? maskPhone(savedNumber.replace(/^55/, '')) : '')
  const [state, setState] = useState<EvolutionState | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null)
  const [finishing, setFinishing] = useState(false)
  const celebratedRef = useRef(false)

  const connected =
    state?.status === 'conectado' ||
    (Boolean(channel?.evolution_instance) && store?.onboarding_step === 'concluido')

  /** Comemora, marca a implementação como concluída e avisa o N8N. */
  const finish = useCallback(async () => {
    if (celebratedRef.current || !tenantId) return
    celebratedRef.current = true

    celebrate()
    setFinishing(true)

    try {
      await updateStore({ onboarding_step: 'concluido' })

      // Sincroniza a equipe de novo agora que a inbox do WhatsApp existe: e
      // esta passada que liga cada vendedor a inbox e faz ele aparecer no
      // seletor "Agente atribuido" da conversa. Nao pode derrubar a conclusao
      // se falhar — o WhatsApp ja esta conectado a esta altura.
      await provisionChatwoot(tenantId).catch(() => undefined)

      const result = await completeProvisioning(tenantId)
      toast(
        result.forwarded
          ? 'Tudo pronto! Sua loja foi enviada para o fluxo de automação.'
          : 'WhatsApp conectado! (webhook do N8N não configurado no servidor)',
        result.forwarded ? 'success' : 'info',
      )
    } catch (err) {
      toast(
        err instanceof Error ? `WhatsApp conectado, mas o envio ao N8N falhou: ${err.message}` : 'Falha ao finalizar.',
        'error',
      )
    } finally {
      setFinishing(false)
      await refresh()
    }
  }, [tenantId, updateStore, refresh, toast])

  // `finish` entra por ref para que o efeito abaixo não dependa dele: se
  // dependesse, cada renderização criaria um intervalo novo.
  const finishRef = useRef(finish)
  useEffect(() => {
    finishRef.current = finish
  }, [finish])

  // Enquanto o QR estiver na tela, consulta o status da instância.
  //
  // O efeito depende de `aguardando` (um booleano), e não de `state`. Antes ele
  // dependia do objeto inteiro, que muda a cada ciclo do polling — então o
  // intervalo era destruído e recriado a cada 3 s, e em qualquer corrida de
  // renderização dava para existir mais de um rodando ao mesmo tempo, cada um
  // batendo na Evolution por conta própria.
  const aguardando = Boolean(state) && state?.status !== 'pendente'

  useEffect(() => {
    if (!tenantId || connected || !aguardando) return

    const timer = setInterval(async () => {
      try {
        const next = await whatsappState(tenantId)
        // O QR nasce no POST /instance; o polling só relata estado. Quando a
        // resposta vem sem QR, mantemos o que já está na tela em vez de apagá-lo.
        setState((prev) => ({ ...next, qrcode: next.qrcode ?? prev?.qrcode ?? null }))
        if (next.status === 'conectado') {
          clearInterval(timer)
          void finishRef.current()
        }
      } catch {
        /* o polling volta a tentar no próximo ciclo */
      }
    }, POLL_INTERVAL)

    return () => clearInterval(timer)
  }, [tenantId, connected, aguardando])

  async function start() {
    if (!tenantId) return
    const digits = onlyDigits(phone)
    if (digits.length < 10) {
      setError({ message: 'Informe o número de WhatsApp da loja com DDD.' })
      return
    }

    setStarting(true)
    setError(null)
    try {
      await updateSettings({ bot_phone: toWhatsappNumber(digits) })
      const next = await createWhatsappInstance(tenantId)
      setState(next)
      if (next.status === 'conectado') void finish()
    } catch (err) {
      setError(
        err instanceof ApiError
          ? { message: err.message, hint: err.hint }
          : { message: err instanceof Error ? err.message : 'Não foi possível gerar o QR Code.' },
      )
    } finally {
      setStarting(false)
    }
  }

  async function reset() {
    if (!tenantId) return
    celebratedRef.current = false
    await disconnectWhatsapp(tenantId).catch(() => undefined)
    setState(null)
    await refresh()
  }

  if (connected) {
    return (
      <StepCard title="WhatsApp conectado" description="Seu agente de IA já está atendendo.">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          className="rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-8 text-center"
        >
          <span className="mx-auto grid size-16 place-items-center rounded-3xl bg-emerald-500 text-white shadow-lg shadow-emerald-500/30">
            <CheckIcon className="size-8" />
          </span>
          <h3 className="mt-5 text-xl font-extrabold text-ink-900">Implementação concluída!</h3>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-600">
            O número <strong>{savedNumber ? maskPhone(savedNumber.replace(/^55/, '')) : ''}</strong> está conectado. A
            partir de agora o agente responde os clientes, apresenta os veículos do seu estoque e agenda visitas
            automaticamente.
          </p>

          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <Link to="/estoque">
              <Button>Ir para o estoque</Button>
            </Link>
            <Button variant="secondary" onClick={() => void reset()} disabled={finishing}>
              Reconectar outro número
            </Button>
          </div>
        </motion.div>
      </StepCard>
    )
  }

  return (
    <StepCard
      title="Conectar o WhatsApp da loja"
      description="Criamos a instância na Evolution API já vinculada à sua central de atendimento e mostramos o QR Code aqui."
      footer={
        <Button variant="ghost" onClick={onBack}>
          Voltar
        </Button>
      }
    >
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <Input
            label="Número do WhatsApp da loja"
            value={phone}
            onChange={(e) => setPhone(maskPhone(e.target.value))}
            placeholder="(41) 99999-9999"
            hint="É o número que vai receber as mensagens dos clientes."
            disabled={Boolean(state)}
          />
          <Button onClick={() => void start()} loading={starting} disabled={Boolean(state)} icon={<WhatsappIcon className="size-4" />}>
            Gerar QR Code
          </Button>
        </div>

        {state && (
          <div className="grid gap-6 rounded-3xl border border-ink-200 bg-ink-50/60 p-6 sm:grid-cols-[auto_1fr] sm:items-center">
            <div className="mx-auto grid size-56 place-items-center overflow-hidden rounded-3xl border border-ink-200 bg-white p-3">
              {state.qrcode ? (
                <img src={state.qrcode} alt="QR Code para conectar o WhatsApp" className="size-full object-contain" />
              ) : (
                <span className="px-4 text-center text-sm text-ink-400">Gerando QR Code…</span>
              )}
            </div>

            <div>
              <span className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">
                <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
                Aguardando leitura
              </span>
              <ol className="mt-4 space-y-3">
                {INSTRUCTIONS.map((instruction, index) => (
                  <li key={instruction} className="flex gap-3 text-sm text-ink-600">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-white text-xs font-bold text-brand-700 shadow-sm">
                      {index + 1}
                    </span>
                    {instruction}
                  </li>
                ))}
              </ol>
              <p className="mt-4 text-xs text-ink-400">
                O QR Code expira em poucos minutos. Se isso acontecer,{' '}
                <button type="button" onClick={() => void reset()} className="font-semibold text-brand-600 underline">
                  gere um novo
                </button>
                .
              </p>
              {state.simulated && (
                <p className="mt-3 text-xs font-semibold text-amber-700">
                  Modo simulação do servidor: nenhuma instância real foi criada na Evolution API.
                </p>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="space-y-2">
            <InfoNote tone="red">{error.message}</InfoNote>
            {error.hint && <InfoNote tone="amber">{error.hint}</InfoNote>}
          </div>
        )}

        {!state && (
          <InfoNote>
            Ao conectar, enviamos automaticamente os dados da loja, os prompts e a equipe de vendas para o fluxo de
            automação no N8N — é o que liga o agente de IA ao seu WhatsApp.
          </InfoNote>
        )}
      </div>
    </StepCard>
  )
}
