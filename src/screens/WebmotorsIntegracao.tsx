import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../core/supabase'
import {
  ApiError,
  webmotorsAtualizar,
  webmotorsConectar,
  webmotorsConfigurar,
  webmotorsDesconectar,
  webmotorsModalidades,
  webmotorsPublicarTudo,
  webmotorsStatus,
  type WebmotorsModalidade,
} from '../core/api'
import {
  WEBMOTORS_SITUACAO,
  esquecerConexaoWebmotors,
  useWebmotors,
  type WebmotorsSituacao,
} from '../core/webmotors'
import { Button } from '../ui/Button'
import { useToast } from '../ui/Feedback'
import { Input, Select } from '../ui/Field'
import { CheckIcon } from '../ui/icons'
import { InfoNote } from './implementation/StepCard'

/**
 * Cartao da Webmotors na tela de Integracoes. A loja conecta com o usuario
 * "Integrador de API" que ela cria no Cockpit da Webmotors; a senha vai so para
 * o servidor (cifrada) e nunca volta para o navegador.
 */

interface CarroResumo {
  id: string
  brand: string | null
  model: string
  version: string | null
  status: string
}

const PROBLEMAS: WebmotorsSituacao[] = ['incompleto', 'erro']

function WebmotorsMarca() {
  return (
    <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[#E1251B] text-[10px] font-black tracking-tight text-white">
      WEB
      <br />
      MOTORS
    </span>
  )
}

const formataCnpj = (valor: string) =>
  valor
    .replace(/\D/g, '')
    .slice(0, 14)
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2')

export function WebmotorsIntegracao({ tenantId, cnpjDaLoja }: { tenantId: string | null; cnpjDaLoja?: string | null }) {
  const { conexao, anuncios, carregando, recarregar } = useWebmotors(tenantId)
  const { toast } = useToast()
  const [liberada, setLiberada] = useState<boolean | null>(null)
  const [ambiente, setAmbiente] = useState<string | null>(null)
  const [cnpj, setCnpj] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [conectando, setConectando] = useState(false)
  const [erro, setErro] = useState<{ message: string; hint?: string } | null>(null)
  const [modalidades, setModalidades] = useState<WebmotorsModalidade[]>([])
  const [publicando, setPublicando] = useState(false)
  const [carros, setCarros] = useState<CarroResumo[]>([])

  useEffect(() => {
    if (!tenantId) return
    void webmotorsStatus(tenantId)
      .then((s) => {
        setLiberada(s.configurada)
        setAmbiente(s.ambiente)
      })
      .catch(() => setLiberada(false))
  }, [tenantId])

  useEffect(() => {
    if (cnpjDaLoja && !cnpj) setCnpj(formataCnpj(cnpjDaLoja))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cnpjDaLoja])

  // Conectada: plano da loja, situação dos anúncios e fotos que ficaram pela metade.
  useEffect(() => {
    if (!tenantId || !conexao) return
    void webmotorsModalidades(tenantId)
      .then(({ itens }) => setModalidades(itens))
      .catch(() => undefined)
    void webmotorsAtualizar(tenantId)
      .then(({ atualizados }) => (atualizados ? recarregar() : undefined))
      .catch(() => undefined)
    void supabase
      .from('cars')
      .select('id,brand,model,version,status')
      .eq('tenant_id', tenantId)
      .then(({ data }) => setCarros((data as CarroResumo[] | null) ?? []))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, Boolean(conexao)])

  async function conectar() {
    if (!tenantId) return
    setConectando(true)
    setErro(null)
    try {
      const r = await webmotorsConectar(tenantId, { cnpj, email, senha })
      setSenha('')
      setModalidades(r.modalidades)
      esquecerConexaoWebmotors(tenantId)
      await recarregar()
      toast('Webmotors conectada.')
    } catch (err) {
      setErro(err instanceof ApiError ? { message: err.message, hint: err.hint } : { message: 'Não foi possível conectar.' })
    } finally {
      setConectando(false)
    }
  }

  async function desconectar() {
    if (!tenantId) return
    if (!window.confirm('Desconectar a Webmotors? Os anúncios que já estão lá continuam; o painel só para de atualizá-los.')) return
    try {
      await webmotorsDesconectar(tenantId)
      esquecerConexaoWebmotors(tenantId)
      await recarregar()
      toast('Webmotors desconectada.', 'info')
    } catch (err) {
      setErro({ message: err instanceof Error ? err.message : 'Falha ao desconectar.' })
    }
  }

  async function configurar(patch: { modalidade_cod?: number }) {
    if (!tenantId) return
    setErro(null)
    try {
      await webmotorsConfigurar(tenantId, patch)
      esquecerConexaoWebmotors(tenantId)
      await recarregar()
    } catch (err) {
      setErro({ message: err instanceof Error ? err.message : 'Não foi possível salvar.' })
    }
  }

  async function publicarTudo() {
    if (!tenantId) return
    setPublicando(true)
    setErro(null)
    const total = { publicados: 0, incompletos: 0, comErro: 0, emAndamento: 0 }
    let aviso: string | null = null
    try {
      // Cada chamada publica o que der no tempo dela; repete enquanto sobrar carro.
      for (let rodada = 0; rodada < 20; rodada++) {
        const r = await webmotorsPublicarTudo(tenantId)
        total.publicados += r.publicados
        total.incompletos += r.incompletos
        total.comErro += r.comErro
        total.emAndamento += r.emAndamento
        aviso = r.aviso ?? aviso
        if (!r.restantes || (r.comErro && !r.publicados && !r.emAndamento)) break
      }
      await recarregar()
      const partes = []
      if (total.publicados) partes.push(`${total.publicados} publicado${total.publicados > 1 ? 's' : ''}`)
      if (total.emAndamento) partes.push(`${total.emAndamento} ainda enviando fotos`)
      if (total.incompletos) partes.push(`${total.incompletos} com informação faltando`)
      if (total.comErro) partes.push(`${total.comErro} com erro`)
      toast(partes.length ? `${partes.join(', ')}.` : 'Nenhum carro novo para publicar.', total.comErro ? 'error' : 'success')
      if (aviso) setErro({ message: aviso })
    } catch (err) {
      setErro(err instanceof ApiError ? { message: err.message, hint: err.hint } : { message: 'Não foi possível publicar agora.' })
    } finally {
      setPublicando(false)
    }
  }

  const contagem = useMemo(() => {
    const c: Partial<Record<WebmotorsSituacao, number>> = {}
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

  const nomesModalidades = modalidades.map((m) => `${m.nome}${m.total ? ` (${m.usados}/${m.total} anúncios)` : ''}`)
  const modalidadeAtual = modalidades.findIndex((m) => m.id === conexao?.modalidade_cod)

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-6 rounded-3xl border border-ink-200 bg-white p-5 shadow-sm sm:p-7"
    >
      <div className="flex flex-wrap items-center gap-4">
        <WebmotorsMarca />
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold text-ink-900">Webmotors</h2>
          <p className="text-sm text-ink-500">
            {conexao
              ? `Conectada · ${conexao.email}${ambiente === 'homologacao' ? ' · ambiente de testes' : ''}`
              : 'Publique, atualize e tire os carros da Webmotors direto do painel.'}
          </p>
        </div>
        {conexao && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            <CheckIcon className="size-3.5" /> Conectada
          </span>
        )}
      </div>

      <div className="mt-5 space-y-2">
        <InfoNote tone="amber">
          A loja precisa ter plano ativo na Webmotors e criar no Cockpit um usuário com perfil “Integrador de API”. Depois,
          no Cockpit, ative a integração em Estoque › Integrações.
        </InfoNote>
        <InfoNote>
          Quem chama pelo anúncio da Webmotors fala com os contatos da loja cadastrados na Webmotors, nunca com o WhatsApp da
          Júlia. Os carros com sinal recebido, vendidos ou excluídos saem da Webmotors sozinhos.
        </InfoNote>
      </div>

      {!conexao && liberada === false && (
        <div className="mt-5">
          <InfoNote>A conexão com a Webmotors está sendo liberada. Em breve você poderá conectar por aqui.</InfoNote>
        </div>
      )}

      {!conexao && liberada && (
        <form
          className="mt-6 space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            void conectar()
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="CNPJ da loja"
              inputMode="numeric"
              value={cnpj}
              onChange={(e) => setCnpj(formataCnpj(e.target.value))}
              placeholder="00.000.000/0000-00"
            />
            <Input
              label="E-mail do usuário Integrador de API"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Input
              label="Senha do usuário Integrador de API"
              type="password"
              autoComplete="new-password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              hint="Fica guardada de forma protegida, só no servidor."
            />
          </div>
          <Button
            type="submit"
            loading={conectando}
            disabled={carregando || cnpj.replace(/\D/g, '').length !== 14 || !email.trim() || !senha}
          >
            Conectar Webmotors
          </Button>
        </form>
      )}

      {conexao && (
        <div className="mt-6 space-y-6">
          <Select
            label="Plano (modalidade) dos anúncios na Webmotors"
            options={nomesModalidades}
            placeholder={modalidades.length ? 'Selecione' : 'Carregando planos da loja…'}
            value={modalidadeAtual >= 0 ? nomesModalidades[modalidadeAtual] : ''}
            onChange={(e) => {
              const escolhida = modalidades[nomesModalidades.indexOf(e.target.value)]
              if (escolhida) void configurar({ modalidade_cod: escolhida.id })
            }}
          />
          {!conexao.modalidade_cod && (
            <InfoNote tone="red">Escolha o plano dos anúncios para começar a publicar.</InfoNote>
          )}

          <InfoNote>
            Você escolhe em quais sites cada carro aparece na hora de salvar o cadastro. Carro com sinal recebido, vendido ou
            excluído sai da Webmotors sozinho, e volta quando fica disponível de novo.
          </InfoNote>

          <div className="flex flex-col gap-4 rounded-2xl border border-ink-200 bg-ink-50/60 p-4 sm:flex-row sm:items-center">
            <div className="flex-1">
              <p className="text-sm font-semibold text-ink-900">Publicar o estoque agora</p>
              <p className="text-xs text-ink-500">
                Manda todos os carros disponíveis marcados para a Webmotors. Os que já estão publicados não são enviados de novo.
              </p>
            </div>
            <Button onClick={() => void publicarTudo()} loading={publicando} disabled={!conexao.modalidade_cod}>
              Publicar estoque na Webmotors
            </Button>
          </div>

          {Object.keys(contagem).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {(Object.keys(contagem) as WebmotorsSituacao[]).map((s) => (
                <span key={s} className={`rounded-full px-3 py-1 text-xs font-semibold ${WEBMOTORS_SITUACAO[s].tom}`}>
                  {WEBMOTORS_SITUACAO[s].label}: {contagem[s]}
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
                      {WEBMOTORS_SITUACAO[anuncio.situacao].label}
                      {anuncio.mensagem ? ` · ${anuncio.mensagem}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-ink-400">Abra o carro no Estoque, clique em editar e complete o que falta.</p>
            </div>
          )}

          <button type="button" onClick={() => void desconectar()} className="text-sm font-semibold text-red-600 hover:underline">
            Desconectar Webmotors
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
  )
}
