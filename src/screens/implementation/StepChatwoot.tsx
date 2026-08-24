import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase } from '../../core/supabase'
import { useTenant } from '../../core/tenant'
import { useAuth } from '../../core/auth'
import { ApiError, chatwootTeam, provisionChatwoot, type ChatwootAgent } from '../../core/api'
import type { SalespersonRole } from '../../core/types'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Field'
import { useToast } from '../../ui/Feedback'
import { CheckIcon, ChatIcon, PlusIcon, TrashIcon } from '../../ui/icons'
import { InfoNote, StepCard } from './StepCard'

const ROLE_LABEL: Record<SalespersonRole, string> = {
  administrator: 'Administrador',
  agent: 'Vendedor',
}

export function StepChatwoot({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const { store, settings, channel, salespeople, refresh } = useTenant()
  const { user } = useAuth()
  const tenantId = store?.tenant_id ?? null
  const { toast } = useToast()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<SalespersonRole>('agent')
  const [adding, setAdding] = useState(false)
  const [sincronizando, setSincronizando] = useState(false)
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null)
  const [avisos, setAvisos] = useState<string[]>([])
  const [agentesDaCentral, setAgentesDaCentral] = useState<ChatwootAgent[]>([])

  const provisioned = Boolean(channel?.chatwoot_account_id)

  // O administrador é o dono da conta. Enquanto ele não existir, o formulário
  // fica travado nesse papel: é o token dele que abre a central para tudo que
  // vem depois, então cadastrar vendedor antes só produz uma central meio-feita.
  const admin = salespeople.find((p) => p.role === 'administrator') ?? null
  const faltaAdmin = !admin
  const vendedores = salespeople.filter((p) => p.role === 'agent')

  // Pré-preenche o administrador com quem está logado — é o dono da loja.
  const prefilled = useRef(false)
  useEffect(() => {
    if (prefilled.current || !faltaAdmin || !user) return
    prefilled.current = true
    setName((user.user_metadata?.full_name as string | undefined) ?? store?.name ?? '')
    setEmail(user.email ?? '')
  }, [faltaAdmin, user, store?.name])

  const carregarAgentes = useCallback(async () => {
    if (!tenantId || !provisioned) return
    try {
      const { agents } = await chatwootTeam(tenantId)
      setAgentesDaCentral(agents)
    } catch {
      /* a checagem de e-mail repetido é um conforto, não pode travar a etapa */
    }
  }, [tenantId, provisioned])

  useEffect(() => {
    void carregarAgentes()
  }, [carregarAgentes])

  async function addPerson(event: FormEvent) {
    event.preventDefault()
    if (!tenantId || !name.trim() || !email.trim()) return

    const papel: SalespersonRole = faltaAdmin ? 'administrator' : role
    const emailLimpo = email.trim().toLowerCase()

    // Avisar antes de gravar, e não depois de o Chatwoot recusar lá na frente.
    const naEquipe = salespeople.find((p) => p.email.toLowerCase() === emailLimpo)
    if (naEquipe) {
      setError({
        message: `${emailLimpo} já está na equipe desta loja, como ${ROLE_LABEL[naEquipe.role].toLowerCase()}.`,
        hint: 'Use outro e-mail ou remova a pessoa da lista antes de cadastrar de novo.',
      })
      return
    }

    const naCentral = agentesDaCentral.find((a) => a.email === emailLimpo)
    if (naCentral) {
      setError({
        message: `${emailLimpo} já tem acesso à central desta loja (${naCentral.name}).`,
        hint: 'Cadastre com outro e-mail, ou remova esse agente no Chatwoot antes de repetir.',
      })
      return
    }

    setAdding(true)
    setError(null)
    const { error: insertError } = await supabase.from('salespeople').insert({
      tenant_id: tenantId,
      name: name.trim(),
      email: emailLimpo,
      role: papel,
    })

    if (insertError) {
      setError({
        message:
          insertError.code === '23505'
            ? 'Esse e-mail já está cadastrado na equipe.'
            : insertError.message,
      })
    } else {
      setName('')
      setEmail('')
      setRole('agent')
      await refresh()
    }
    setAdding(false)
  }

  async function removePerson(id: string) {
    await supabase.from('salespeople').delete().eq('id', id)
    await refresh()
  }

  /**
   * Não existe mais botão de sincronizar: quem sincroniza é o Continuar. A
   * central precisa existir antes da etapa 4 (é a Evolution que cria a inbox
   * dentro dela), então este é o último momento possível. Ao concluir a
   * implantação a equipe é sincronizada de novo, aí já com a inbox no lugar.
   */
  async function continuar() {
    if (!tenantId) return

    if (faltaAdmin) {
      setError({ message: 'Cadastre o administrador da loja antes de seguir.' })
      return
    }

    setSincronizando(true)
    setError(null)
    setAvisos([])

    try {
      const result = await provisionChatwoot(tenantId)
      await refresh()
      await carregarAgentes()

      if (result.conflitos?.length) {
        // O e-mail existe em outra conta do mesmo Chatwoot. Não dá para seguir
        // fingindo que a pessoa entrou: ela não receberia conversa nenhuma.
        setAvisos(result.conflitos.map((c) => `${c.nome} (${c.email}): ${c.motivo}`))
        setError({
          message: 'Alguns e-mails não puderam ser cadastrados na central.',
          hint: 'Troque o e-mail dessas pessoas na lista acima e clique em Continuar de novo.',
        })
        return
      }

      if (result.warning) {
        setError({ message: result.warning })
        toast('Central já existente — veja o aviso abaixo.', 'info')
        return
      }

      toast(`Central sincronizada com ${result.users.length} pessoa(s).`)
      onNext()
    } catch (err) {
      setError(
        err instanceof ApiError
          ? { message: err.message, hint: err.hint }
          : { message: err instanceof Error ? err.message : 'Falha ao sincronizar a central.' },
      )
    } finally {
      setSincronizando(false)
    }
  }

  return (
    <StepCard
      title="Central de atendimento & vendedores"
      description="Criamos a conta da sua loja no Chatwoot e damos acesso à sua equipe. É lá que os vendedores assumem a conversa quando a IA transfere."
      footer={
        <>
          <Button variant="ghost" onClick={onBack} disabled={sincronizando}>
            Voltar
          </Button>
          <Button onClick={() => void continuar()} loading={sincronizando} disabled={faltaAdmin}>
            Continuar
          </Button>
        </>
      }
    >
      <div className="space-y-8">
        {provisioned ? (
          <div className="flex items-center gap-4 rounded-3xl border border-emerald-200 bg-emerald-50 p-5">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-emerald-500 text-white">
              <CheckIcon />
            </span>
            <div>
              <h3 className="text-sm font-bold text-emerald-900">Central provisionada</h3>
              <p className="text-sm text-emerald-800">
                Conta #{channel?.chatwoot_account_id} criada em {settings?.chatwoot_base_url ?? 'seu Chatwoot'}.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-4 rounded-3xl border border-ink-200 bg-ink-50/60 p-5">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white text-brand-600 shadow-sm">
              <ChatIcon />
            </span>
            <div>
              <h3 className="text-sm font-bold text-ink-900">Sua central ainda não foi criada</h3>
              <p className="text-sm text-ink-500">
                Cadastre o administrador e a equipe. Ao clicar em Continuar, criamos tudo no Chatwoot.
              </p>
            </div>
          </div>
        )}

        <section>
          <h3 className="text-sm font-bold text-ink-900">
            {faltaAdmin ? 'Administrador da loja' : 'Equipe de vendas'}
          </h3>
          <p className="mt-1 text-xs text-ink-500">
            {faltaAdmin
              ? 'Comece pelo dono da loja: é a conta que administra a central. Depois de cadastrá-lo, os vendedores são liberados.'
              : 'Cada pessoa recebe um convite por e-mail do Chatwoot para definir a própria senha.'}
          </p>

          <form onSubmit={addPerson} className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <Input
              placeholder={faltaAdmin ? 'Nome do administrador' : 'Nome do vendedor'}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Input
              type="email"
              placeholder="email@loja.com.br"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <div className="flex gap-2">
              <select
                value={faltaAdmin ? 'administrator' : role}
                onChange={(e) => setRole(e.target.value as SalespersonRole)}
                disabled={faltaAdmin}
                className="rounded-2xl border border-ink-200 bg-white px-3 text-sm focus:border-brand-500 focus:outline-none disabled:cursor-not-allowed disabled:bg-ink-50 disabled:text-ink-500"
              >
                <option value="agent">Vendedor</option>
                <option value="administrator">Administrador</option>
              </select>
              <Button type="submit" loading={adding} icon={<PlusIcon className="size-4" />} aria-label="Adicionar" />
            </div>
          </form>

          {salespeople.length > 0 && (
            <ul className="mt-4 divide-y divide-ink-100 rounded-2xl border border-ink-100">
              {salespeople.map((person) => (
                <li key={person.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
                    {person.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink-900">{person.name}</span>
                    <span className="block truncate text-xs text-ink-500">{person.email}</span>
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[0.65rem] font-bold ${
                      person.role === 'administrator' ? 'bg-brand-100 text-brand-700' : 'bg-ink-100 text-ink-600'
                    }`}
                  >
                    {ROLE_LABEL[person.role]}
                  </span>
                  <button
                    type="button"
                    onClick={() => void removePerson(person.id)}
                    aria-label={`Remover ${person.name}`}
                    className="grid size-8 place-items-center rounded-xl text-ink-400 transition-colors hover:bg-red-50 hover:text-red-600"
                  >
                    <TrashIcon className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {!faltaAdmin && vendedores.length === 0 && (
            <p className="mt-3 text-xs text-ink-500">
              Administrador cadastrado. Agora inclua os vendedores — são eles que aparecem para a Julia escolher
              quando transfere uma conversa.
            </p>
          )}
        </section>

        {avisos.length > 0 && (
          <ul className="space-y-2">
            {avisos.map((aviso) => (
              <li key={aviso}>
                <InfoNote tone="amber">{aviso}</InfoNote>
              </li>
            ))}
          </ul>
        )}

        {error && (
          <div className="space-y-2">
            <InfoNote tone="red">{error.message}</InfoNote>
            {error.hint && <InfoNote tone="amber">{error.hint}</InfoNote>}
          </div>
        )}

        <p className="text-xs text-ink-400">
          A sincronização com o Chatwoot acontece sozinha ao clicar em Continuar, e outra vez quando você conclui a
          implantação. Usa a chave Super Admin do Chatwoot, guardada apenas no servidor.
        </p>
      </div>
    </StepCard>
  )
}
