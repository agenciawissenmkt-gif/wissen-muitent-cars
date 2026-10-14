import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { useTenant } from '../core/tenant'
import { supabase } from '../core/supabase'
import { ApiError, olxAtualizar, olxAuthUrl, olxConfigurar, olxDesconectar, olxPublicarTudo } from '../core/api'
import { OLX_SITUACAO, esquecerConexaoOlx, useOlx, type OlxSituacao } from '../core/olx'
import { Button } from '../ui/Button'
import { useToast } from '../ui/Feedback'
import { Input, Toggle } from '../ui/Field'
import { CheckIcon, PlugIcon } from '../ui/icons'
import { InfoNote } from './implementation/StepCard'

/**
 * Integracoes do estoque com sites de anuncio (OLX hoje; outros depois).
 * Separado da Implementacao e da Visao Geral: aqui e so anuncio, nada da Julia.
 */

interface CarroResumo {
  id: string
  brand: string | null
  model: string
  version: string | null
  status: string
}

const PROBLEMAS: OlxSituacao[] = ['incompleto', 'recusado', 'erro']

function OlxMarca() {
  return (
    <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[#6E0AD6] text-sm font-black tracking-tight text-white">
      OLX
    </span>
  )
}

export function Integrations() {
  const { store, settings, channel } = useTenant()
  const tenantId = store?.tenant_id ?? null
  const { conexao, anuncios, carregando, recarregar } = useOlx(tenantId)
  const { toast } = useToast()
  const [conectando, setConectando] = useState(false)
  const [erro, setErro] = useState<{ message: string; hint?: string } | null>(null)
  const [telefone, setTelefone] = useState('')
  const [salvandoTelefone, setSalvandoTelefone] = useState(false)
  const [publicando, setPublicando] = useState(false)
  const [carros, setCarros] = useState<CarroResumo[]>([])

  useEffect(() => setTelefone(conexao?.telefone_anuncio ?? ''), [conexao?.telefone_anuncio])

  // Situação dos anúncios: pergunta à OLX ao abrir a tela.
  useEffect(() => {
    if (!tenantId || !conexao) return
    void olxAtualizar(tenantId)
      .then(({ atualizados }) => (atualizados ? recarregar() : undefined))
      .catch(() => undefined)
    void supabase
      .from('cars')
      .select('id,brand,model,version,status')
      .eq('tenant_id', tenantId)
      .then(({ data }) => setCarros((data as CarroResumo[] | null) ?? []))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, Boolean(conexao)])

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return
      if (event.data?.type !== 'wissen:olx') return
      setConectando(false)
      if (event.data.ok) {
        if (tenantId) esquecerConexaoOlx(tenantId)
        void recarregar()
        toast('OLX conectada.')
      } else {
        setErro({ message: String(event.data.error ?? 'Não foi possível concluir a autorização.') })
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [recarregar, toast, tenantId])

  async function conectar() {
    if (!tenantId) return
    setConectando(true)
    setErro(null)
    try {
      const { url } = await olxAuthUrl(tenantId)
      const popup = window.open(url, 'wissen-olx', 'width=520,height=720')
      if (!popup) {
        setConectando(false)
        setErro({ message: 'O navegador bloqueou a janela da OLX. Libere os pop-ups e tente de novo.' })
      }
    } catch (err) {
      setConectando(false)
      setErro(err instanceof ApiError ? { message: err.message, hint: err.hint } : { message: 'Não foi possível abrir a OLX.' })
    }
  }

  async function desconectar() {
    if (!tenantId) return
    if (!window.confirm('Desconectar a OLX? Os anúncios que já estão na OLX continuam lá; o painel só para de atualizá-los.')) return
    try {
      await olxDesconectar(tenantId)
      esquecerConexaoOlx(tenantId)
      await recarregar()
      toast('OLX desconectada.', 'info')
    } catch (err) {
      setErro({ message: err instanceof Error ? err.message : 'Falha ao desconectar.' })
    }
  }

  async function salvarTelefone() {
    if (!tenantId) return
    setSalvandoTelefone(true)
    setErro(null)
    try {
      await olxConfigurar(tenantId, { telefone_anuncio: telefone })
      esquecerConexaoOlx(tenantId)
      await recarregar()
      toast('Telefone do anúncio salvo.')
    } catch (err) {
      setErro({ message: err instanceof Error ? err.message : 'Não foi possível salvar o telefone.' })
    } finally {
      setSalvandoTelefone(false)
    }
  }

  async function alternarAutomatico(valor: boolean) {
    if (!tenantId) return
    try {
      await olxConfigurar(tenantId, { publicar_tudo: valor })
      esquecerConexaoOlx(tenantId)
      await recarregar()
    } catch (err) {
      setErro({ message: err instanceof Error ? err.message : 'Não foi possível salvar.' })
    }
  }

  async function publicarTudo() {
    if (!tenantId) return
    setPublicando(true)
    setErro(null)
    try {
      const r = await olxPublicarTudo(tenantId)
      await recarregar()
      const partes = []
      if (r.enviados) partes.push(`${r.enviados} enviado${r.enviados > 1 ? 's' : ''} para a OLX`)
      if (r.iguais) partes.push(`${r.iguais} já estava${r.iguais > 1 ? 'm' : ''} em dia`)
      if (r.incompletos) partes.push(`${r.incompletos} com informação faltando`)
      if (r.comErro) partes.push(`${r.comErro} com erro`)
      toast(partes.length ? `${partes.join(', ')}.` : 'Nenhum carro disponível para publicar.', r.comErro ? 'error' : 'success')
      if (r.aviso) setErro({ message: r.aviso })
    } catch (err) {
      setErro(err instanceof ApiError ? { message: err.message, hint: err.hint } : { message: 'Não foi possível publicar agora.' })
    } finally {
      setPublicando(false)
    }
  }

  const contagem = useMemo(() => {
    const c: Partial<Record<OlxSituacao, number>> = {}
    for (const a of Object.values(anuncios)) c[a.situacao] = (c[a.situacao] ?? 0) + 1
    return c
  }, [anuncios])

  const problemas = useMemo(
    () =>
      Object.values(anuncios)
        .filter((a) => PROBLEMAS.includes(a.situacao))
        .map((a) => ({ anuncio: a, carro: carros.find((c) => c.id === a.car_id) }))
        .filter((p) => p.carro && p.carro.status === 'ativo'),
    [anuncios, carros],
  )

  const numeroJulia = channel?.whatsapp_number || settings?.bot_phone || null

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8">
      <header>
        <h1 className="text-2xl font-extrabold text-ink-900 sm:text-3xl">Integrações</h1>
        <p className="mt-1 text-sm text-ink-500">Anuncie o estoque em outros sites direto do painel. Nada aqui muda a Júlia.</p>
      </header>

      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="mt-6 rounded-3xl border border-ink-200 bg-white p-5 shadow-sm sm:p-7"
      >
        <div className="flex flex-wrap items-center gap-4">
          <OlxMarca />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-ink-900">OLX</h2>
            <p className="text-sm text-ink-500">
              {conexao
                ? `Conectada${conexao.conta_nome || conexao.conta_email ? ` · ${conexao.conta_nome ?? conexao.conta_email}` : ''}`
                : 'Publique e atualize os carros na OLX sem digitar tudo de novo.'}
            </p>
          </div>
          {conexao ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              <CheckIcon className="size-3.5" /> Conectada
            </span>
          ) : (
            <Button onClick={() => void conectar()} loading={conectando} disabled={carregando}>
              Conectar OLX
            </Button>
          )}
        </div>

        <div className="mt-5 space-y-2">
          <InfoNote tone="amber">
            Para publicar pelo painel, a conta da OLX precisa ser de loja (plano profissional da OLX). Conta pessoal não
            permite publicação por integração.
          </InfoNote>
          <InfoNote>
            Quem chama pelo anúncio da OLX fala com o telefone da loja que você escolher aqui, nunca com o WhatsApp da
            Júlia. Os carros com sinal recebido, vendidos ou excluídos saem da OLX sozinhos.
          </InfoNote>
        </div>

        {conexao && (
          <div className="mt-6 space-y-6">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <Input
                label="Telefone do anúncio"
                inputMode="tel"
                value={telefone}
                onChange={(e) => setTelefone(e.target.value.replace(/[^\d() -]/g, ''))}
                placeholder="11987654321"
                hint={
                  numeroJulia
                    ? 'Um número da loja com DDD. Não pode ser o WhatsApp da Júlia.'
                    : 'Um número da loja com DDD.'
                }
              />
              <Button
                variant="secondary"
                onClick={() => void salvarTelefone()}
                loading={salvandoTelefone}
                disabled={!telefone.trim() || telefone.replace(/\D/g, '') === (conexao.telefone_anuncio ?? '')}
              >
                Salvar telefone
              </Button>
            </div>
            {!conexao.telefone_anuncio && (
              <InfoNote tone="red">Cadastre o telefone do anúncio para começar a publicar.</InfoNote>
            )}

            <Toggle
              checked={conexao.publicar_tudo}
              onChange={(v) => void alternarAutomatico(v)}
              label="Publicar tudo automaticamente"
              description="Todo carro disponível vai para a OLX ao salvar, e sai dela quando recebe sinal, é vendido ou excluído. Desligado, você publica com o botão abaixo ou pelo cadastro de cada carro."
            />

            <div className="flex flex-col gap-4 rounded-2xl border border-ink-200 bg-ink-50/60 p-4 sm:flex-row sm:items-center">
              <div className="flex-1">
                <p className="text-sm font-semibold text-ink-900">Publicar o estoque agora</p>
                <p className="text-xs text-ink-500">
                  Manda de uma vez todos os carros disponíveis liberados para a OLX. Os que já estão em dia não são enviados de novo.
                </p>
              </div>
              <Button onClick={() => void publicarTudo()} loading={publicando} disabled={!conexao.telefone_anuncio}>
                Publicar estoque na OLX
              </Button>
            </div>

            {Object.keys(contagem).length > 0 && (
              <div className="flex flex-wrap gap-2">
                {(Object.keys(contagem) as OlxSituacao[]).map((s) => (
                  <span key={s} className={`rounded-full px-3 py-1 text-xs font-semibold ${OLX_SITUACAO[s].tom}`}>
                    {OLX_SITUACAO[s].label}: {contagem[s]}
                  </span>
                ))}
              </div>
            )}

            {problemas.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-semibold text-ink-900">Precisam de atenção</p>
                <ul className="divide-y divide-ink-100 rounded-2xl border border-ink-200">
                  {problemas.map(({ anuncio, carro }) => (
                    <li key={anuncio.car_id} className="px-4 py-3">
                      <p className="text-sm font-semibold text-ink-900">
                        {[carro?.brand, carro?.model, carro?.version].filter(Boolean).join(' ')}
                      </p>
                      <p className="text-xs text-ink-500">
                        {OLX_SITUACAO[anuncio.situacao].label}
                        {anuncio.mensagem ? ` · ${anuncio.mensagem}` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-ink-400">Abra o carro no Estoque, clique em editar e complete o que falta.</p>
              </div>
            )}

            <button type="button" onClick={() => void desconectar()} className="text-sm font-semibold text-red-600 hover:underline">
              Desconectar OLX
            </button>
          </div>
        )}

        {erro && (
          <div className="mt-5 space-y-2">
            <InfoNote tone="red">{erro.message}</InfoNote>
            {erro.hint && <InfoNote tone="amber">{erro.hint}</InfoNote>}
          </div>
        )}
      </motion.section>

      <section className="mt-6 flex items-center gap-4 rounded-3xl border border-dashed border-ink-200 p-5 text-ink-400">
        <span className="grid size-12 place-items-center rounded-2xl bg-ink-100">
          <PlugIcon />
        </span>
        <div>
          <p className="text-sm font-semibold text-ink-600">Outros sites de anúncio</p>
          <p className="text-xs">Webmotors e outros portais entram aqui em breve.</p>
        </div>
      </section>
    </div>
  )
}
