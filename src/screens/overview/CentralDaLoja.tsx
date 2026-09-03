import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useTenant } from '../../core/tenant'
import { ApiError, chatwootSsoUrl } from '../../core/api'
import type { Salesperson } from '../../core/types'
import { ChatwootMark } from '../../ui/icons'

/** "Maria Eduarda" -> "ME" · "Duda" -> "DU" */
function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return '?'
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase()
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase()
}

/**
 * Cor estável por pessoa: a mesma pessoa fica sempre com a mesma cor, sem
 * precisar guardar isso no banco.
 */
const CORES = [
  'bg-brand-100 text-brand-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-800',
  'bg-sky-100 text-sky-700',
  'bg-rose-100 text-rose-700',
  'bg-violet-100 text-violet-700',
]

function corDe(chave: string): string {
  let soma = 0
  for (let i = 0; i < chave.length; i += 1) soma += chave.charCodeAt(i)
  return CORES[soma % CORES.length]
}

export function CentralDaLoja() {
  const { store, channel, salespeople } = useTenant()
  const tenantId = store?.tenant_id ?? null

  const [abrindo, setAbrindo] = useState<string | null>(null)
  const [erro, setErro] = useState<{ message: string; hint?: string } | null>(null)

  const provisionada = Boolean(channel?.chatwoot_account_id)
  const admin = salespeople.find((p) => p.role === 'administrator') ?? null
  const vendedores = salespeople.filter((p) => p.role === 'agent')

  /**
   * A aba precisa ser aberta no clique, de forma síncrona: se abrirmos depois
   * do await, o navegador entende como pop-up e bloqueia. Abrimos em branco e
   * só então mandamos o endereço.
   */
  async function entrar(pessoa: Salesperson) {
    if (!tenantId || abrindo) return

    const aba = window.open('about:blank', '_blank')
    setAbrindo(pessoa.id)
    setErro(null)

    try {
      const { url } = await chatwootSsoUrl(tenantId, pessoa.id)
      if (aba && !aba.closed) {
        aba.opener = null
        aba.location.replace(url)
        aba.focus()
      } else {
        // popup bloqueado: abre direto, sem nunca navegar a aba atual
        window.open(url, '_blank', 'noopener,noreferrer')
      }
    } catch (err) {
      aba?.close()
      setErro(
        err instanceof ApiError
          ? { message: err.message, hint: err.hint }
          : { message: err instanceof Error ? err.message : 'Não foi possível abrir a central.' },
      )
    } finally {
      setAbrindo(null)
    }
  }

  if (!provisionada) {
    return (
      <section className="mt-6 rounded-3xl border border-ink-100 bg-white p-6 shadow-sm">
        <h2 className="text-base font-bold text-ink-900">Central de atendimento</h2>
        <p className="mt-1 text-sm text-ink-500">
          A central da loja ainda não foi criada.{' '}
          <Link to="/implementacao" className="font-semibold text-brand-600 hover:text-brand-700">
            Conclua a etapa 3 da implementação
          </Link>{' '}
          para liberar o acesso da equipe.
        </p>
      </section>
    )
  }

  return (
    <section className="mt-6 rounded-3xl border border-ink-100 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-ink-900">Central de atendimento</h2>
          <p className="mt-1 text-sm text-ink-500">
            Clique na foto para entrar direto na conta da pessoa, sem senha.
          </p>
        </div>
        <Link to="/implementacao" className="text-sm font-semibold text-brand-600 hover:text-brand-700">
          Gerenciar equipe
        </Link>
      </div>

      <div className="mt-6 flex flex-wrap items-start gap-x-7 gap-y-6">
        {admin && (
          <>
            <Pessoa
              pessoa={admin}
              principal
              carregando={abrindo === admin.id}
              desabilitado={Boolean(abrindo)}
              onClick={() => void entrar(admin)}
            />
            {vendedores.length > 0 && <span className="mt-3 hidden h-14 w-px bg-ink-100 sm:block" />}
          </>
        )}

        {vendedores.map((pessoa) => (
          <Pessoa
            key={pessoa.id}
            pessoa={pessoa}
            carregando={abrindo === pessoa.id}
            desabilitado={Boolean(abrindo)}
            onClick={() => void entrar(pessoa)}
          />
        ))}

        {salespeople.length === 0 && (
          <p className="text-sm text-ink-500">
            Nenhuma pessoa cadastrada ainda.{' '}
            <Link to="/implementacao" className="font-semibold text-brand-600">
              Cadastre a equipe
            </Link>
            .
          </p>
        )}
      </div>

      {erro && (
        <div className="mt-5 space-y-2">
          <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{erro.message}</p>
          {erro.hint && (
            <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {erro.hint}
            </p>
          )}
        </div>
      )}

      <p className="mt-5 text-xs text-ink-400">
        Qualquer pessoa com este painel aberto entra em qualquer uma dessas contas. Se a loja precisar que cada
        vendedor use a própria senha, me avise que eu troco.
      </p>
    </section>
  )
}

function Pessoa({
  pessoa,
  principal = false,
  carregando,
  desabilitado,
  onClick,
}: {
  pessoa: Salesperson
  principal?: boolean
  carregando: boolean
  desabilitado: boolean
  onClick: () => void
}) {
  const sincronizada = Boolean(pessoa.chatwoot_user_id)
  const tamanho = principal ? 'size-16' : 'size-14'

  if (!sincronizada) {
    return (
      <Link
        to="/implementacao"
        title={`${pessoa.name} ainda não tem conta na central. Clique para sincronizar na etapa 3.`}
        className="flex w-20 flex-col items-center gap-2 text-center"
      >
        <span
          className={`grid ${tamanho} place-items-center rounded-full border-2 border-dashed border-ink-300 text-sm font-bold text-ink-400`}
        >
          {iniciais(pessoa.name)}
        </span>
        <span className="w-full truncate text-xs font-semibold text-ink-400">{pessoa.name}</span>
        <span className="text-[0.65rem] text-amber-600">pendente</span>
      </Link>
    )
  }

  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={desabilitado}
      whileHover={{ scale: desabilitado ? 1 : 1.05 }}
      whileTap={{ scale: desabilitado ? 1 : 0.96 }}
      title={`Entrar na central como ${pessoa.name} (${pessoa.email})`}
      className="flex w-20 flex-col items-center gap-2 text-center disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span className="relative">
        <span
          className={`grid ${tamanho} place-items-center rounded-full font-bold shadow-sm ${
            principal ? 'bg-[#1F93FF] text-white' : corDe(pessoa.id)
          } ${principal ? '' : 'text-base'}`}
        >
          {carregando ? (
            <span className="size-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : principal ? (
            <ChatwootMark className="size-8" />
          ) : (
            iniciais(pessoa.name)
          )}
        </span>
        {principal && (
          <span className="absolute -bottom-0.5 -right-0.5 grid size-5 place-items-center rounded-full bg-white text-[0.6rem] font-bold text-brand-700 shadow">
            ★
          </span>
        )}
      </span>
      <span className="w-full truncate text-xs font-semibold text-ink-900">{pessoa.name}</span>
      <span className="text-[0.65rem] text-ink-400">{principal ? 'Administrador' : 'Vendedor'}</span>
    </motion.button>
  )
}
