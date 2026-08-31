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

// O WhatsApp nao autoriza este tipo de automacao. Nao existe configuracao que
// deixe um numero imune -- o que existe e um perfil de numero que quase nunca e
// banido e outro que e banido em dias. A diferenca esta nestas quatro coisas, e
// ate hoje o painel nao falava nenhuma delas: mostrava o QR e pronto.
const REGRAS_DO_NUMERO = [
  {
    id: 'nao-e-chip-novo',
    titulo: 'Este numero nao e um chip novo.',
    porque: 'Ja e usado ha algumas semanas e tem conversa de verdade no historico. Numero recem-registrado que comeca a responder sozinho e o que mais chama atencao.',
  },
  {
    id: 'nao-e-pessoal',
    titulo: 'Este numero nao e o WhatsApp pessoal de ninguem.',
    porque: 'E um numero da loja. Se o pior acontecer, voce perde um numero de trabalho e nao o contato da familia de alguem.',
  },
  {
    id: 'nao-esta-em-outro-lugar',
    titulo: 'Este numero nao esta ligado em nenhum outro sistema.',
    porque: 'Nenhum outro painel, robo ou disparador usando o mesmo WhatsApp. O mesmo numero conectado em dois lugares e o sinal mais facil de detectar.',
  },
  {
    id: 'sem-disparo',
    titulo: 'A loja nao vai disparar mensagem em massa por aqui.',
    porque: 'A Julia responde quem escreve primeiro; ela nao sai puxando conversa com lista de contatos. Denuncia de quem nao conhece o numero e o gatilho mais rapido de bloqueio.',
  },
]

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
  const [marcadas, setMarcadas] = useState<string[]>([])

  const todasMarcadas = REGRAS_DO_NUMERO.every((r) => marcadas.includes(r.id))

  // Duas coisas diferentes que antes eram uma só.
  //
  // O WhatsApp estar pareado NAO significa que a loja esta no ar: falta o aviso
  // ao N8N, que e quem cria o fluxo do agente. Enquanto isso era um booleano so,
  // a tela comemorava "seu agente ja esta atendendo" com base apenas no QR lido
  // -- inclusive quando o N8N nunca tinha sido avisado.
  const whatsappPareado = state?.status === 'conectado' || Boolean(channel?.evolution_instance)
  const lojaAtivada = store?.onboarding_step === 'concluido'
  const connected = whatsappPareado && lojaAtivada

  /**
   * Avisa o N8N e só então marca a implementação como concluída.
   *
   * A ordem importa mais do que parece. Antes esta função marcava
   * `concluido` primeiro e chamava o N8N depois: quando essa chamada falhava
   * (webhook fora do ar, timeout, URL errada no ambiente), o erro virava um
   * toast que sumia em cinco segundos e a tela passava a exibir "Seu agente de
   * IA já está atendendo" — cujo único botão desconecta o WhatsApp. O lojista
   * via os confetes, fechava o painel, e o fluxo do agente nunca tinha sido
   * criado para a loja dele. Não havia caminho nenhum para tentar de novo.
   *
   * Agora nada é dado como concluído antes de o N8N confirmar, a comemoração
   * só acontece no sucesso, e a falha deixa o botão disponível para repetir.
   */
  const finish = useCallback(async () => {
    if (celebratedRef.current || finishing || !tenantId) return
    setFinishing(true)
    setError(null)

    try {
      // Sincroniza a equipe de novo agora que a inbox do WhatsApp existe: e
      // esta passada que liga cada vendedor a inbox e faz ele aparecer no
      // seletor "Agente atribuido" da conversa. Nao pode derrubar a conclusao
      // se falhar — o WhatsApp ja esta conectado a esta altura.
      await provisionChatwoot(tenantId).catch(() => undefined)

      const result = await completeProvisioning(tenantId)

      if (!result.forwarded) {
        throw new Error(
          'O servidor não conseguiu entregar sua loja ao fluxo de automação. Sem isso o agente não atende ninguém.',
        )
      }

      await updateStore({ onboarding_step: 'concluido' })

      celebratedRef.current = true
      celebrate()
      toast('Tudo pronto! Sua loja foi enviada para o fluxo de automação.', 'success')
    } catch (err) {
      setError({
        message:
          err instanceof Error
            ? `Seu WhatsApp está conectado, mas a loja ainda não foi ativada: ${err.message}`
            : 'Seu WhatsApp está conectado, mas a loja ainda não foi ativada.',
        hint: 'Clique em "Concluir implementação" para tentar de novo. Nada do que você já fez foi perdido.',
      })
    } finally {
      setFinishing(false)
      await refresh()
    }
  }, [tenantId, finishing, updateStore, refresh, toast])

  // `finish` entra por ref para que o efeito abaixo não dependa dele: se
  // dependesse, cada renderização criaria um intervalo novo.
  const finishRef = useRef(finish)
  useEffect(() => {
    finishRef.current = finish
  }, [finish])

  // Retomada automática, uma vez por visita à tela.
  //
  // Cobre o caso mais comum de implantação pela metade: o lojista lê o QR, o
  // WhatsApp pareia e ele fecha a aba (ou o 4G cai) antes de o painel confirmar.
  // Quando ele volta, o número está pareado e a loja não foi ativada — e o certo
  // é o painel terminar sozinho, não esperar que ele descubra um botão.
  const tentouRetomarRef = useRef(false)
  useEffect(() => {
    if (tentouRetomarRef.current) return
    if (!tenantId || !whatsappPareado || lojaAtivada) return
    tentouRetomarRef.current = true
    void finishRef.current()
  }, [tenantId, whatsappPareado, lojaAtivada])

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
      // registro de que o lojista foi avisado, e data do vinculo deste numero
      await updateStore({ whatsapp_checklist_em: new Date().toISOString() }).catch(() => undefined)
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
    setMarcadas([])
    await refresh()
  }

  // WhatsApp pareado e loja nao ativada: ou o aviso ao N8N falhou, ou o lojista
  // fechou a aba entre a leitura do QR e a confirmacao. Antes esse estado era
  // indistinguivel do sucesso e nao tinha saida. Agora tem botao.
  if (whatsappPareado && !lojaAtivada) {
    return (
      <StepCard
        title="Falta um passo"
        description="Seu WhatsApp está conectado, mas a loja ainda não foi ativada no fluxo de atendimento."
      >
        <div className="space-y-5">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <p className="text-sm leading-relaxed text-ink-700">
              O número já está pareado — isso não se perde. O que falta é avisar o fluxo de automação, que é quem
              coloca o agente para atender. <strong>Até isso acontecer, ninguém é respondido.</strong>
            </p>
            {error && (
              <p className="mt-3 text-sm leading-relaxed text-amber-900">
                {error.message}
                {error.hint ? <span className="mt-1 block text-amber-800/80">{error.hint}</span> : null}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void finish()} loading={finishing}>
              Concluir implementação
            </Button>
            <Button variant="secondary" onClick={() => void reset()} disabled={finishing}>
              Reconectar outro número
            </Button>
          </div>
        </div>
      </StepCard>
    )
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
        {!state && (
          <div className="rounded-3xl border border-amber-200 bg-amber-50/70 p-6">
            <h3 className="text-sm font-extrabold text-amber-900">Antes de ler o QR Code</h3>
            <p className="mt-2 text-sm leading-relaxed text-amber-800">
              O WhatsApp não autoriza oficialmente este tipo de automação. Não existe ajuste que deixe um número imune —
              o que existe é um perfil de número que quase nunca é banido, e outro que é banido em dias.{' '}
              <strong>Número banido não volta.</strong> Confirme as quatro para continuar.
            </p>

            <ul className="mt-5 space-y-3">
              {REGRAS_DO_NUMERO.map((regra) => {
                const marcada = marcadas.includes(regra.id)
                return (
                  <li key={regra.id}>
                    <label className="flex cursor-pointer gap-3 rounded-2xl bg-white/70 p-3 transition hover:bg-white">
                      <input
                        type="checkbox"
                        checked={marcada}
                        onChange={(e) =>
                          setMarcadas((atual) =>
                            e.target.checked ? [...atual, regra.id] : atual.filter((id) => id !== regra.id),
                          )
                        }
                        className="mt-0.5 size-4 shrink-0 accent-amber-600"
                      />
                      <span>
                        <span className="block text-sm font-bold text-ink-900">{regra.titulo}</span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-ink-500">{regra.porque}</span>
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <Input
            label="Número do WhatsApp da loja"
            value={phone}
            onChange={(e) => setPhone(maskPhone(e.target.value))}
            placeholder="(41) 99999-9999"
            hint="É o número que vai receber as mensagens dos clientes."
            disabled={Boolean(state)}
          />
          <Button
            onClick={() => void start()}
            loading={starting}
            disabled={Boolean(state) || !todasMarcadas}
            icon={<WhatsappIcon className="size-4" />}
          >
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
