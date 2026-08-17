import { useState, type FormEvent } from 'react'
import { supabase } from '../../core/supabase'
import { useTenant } from '../../core/tenant'
import { ApiError, provisionChatwoot } from '../../core/api'
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
  const tenantId = store?.tenant_id ?? null
  const { toast } = useToast()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<SalespersonRole>('agent')
  const [adding, setAdding] = useState(false)
  const [provisioning, setProvisioning] = useState(false)
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null)

  const provisioned = Boolean(channel?.chatwoot_account_id)

  async function addPerson(event: FormEvent) {
    event.preventDefault()
    if (!tenantId || !name.trim() || !email.trim()) return

    setAdding(true)
    setError(null)
    const { error: insertError } = await supabase.from('salespeople').insert({
      tenant_id: tenantId,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      role,
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

  async function provision() {
    if (!tenantId) return
    if (salespeople.length === 0) {
      setError({ message: 'Cadastre pelo menos um membro da equipe antes de criar a central.' })
      return
    }

    setProvisioning(true)
    setError(null)
    try {
      const result = await provisionChatwoot(tenantId)
      await refresh()

      if (result.warning) {
        setError({ message: result.warning })
        toast('Central já existente — veja o aviso abaixo.', 'info')
      } else {
        toast(`Central criada (conta #${result.account_id}) com ${result.users.length} usuário(s).`)
      }
    } catch (err) {
      setError(
        err instanceof ApiError
          ? { message: err.message, hint: err.hint }
          : { message: err instanceof Error ? err.message : 'Falha ao provisionar a central.' },
      )
    } finally {
      setProvisioning(false)
    }
  }

  return (
    <StepCard
      title="Central de atendimento & vendedores"
      description="Criamos a conta da sua loja no Chatwoot e damos acesso à sua equipe. É lá que os vendedores assumem a conversa quando a IA transfere."
      footer={
        <>
          <Button variant="ghost" onClick={onBack}>
            Voltar
          </Button>
          <Button onClick={onNext} variant={provisioned ? 'primary' : 'secondary'}>
            {provisioned ? 'Continuar' : 'Pular por enquanto'}
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
              <p className="text-sm text-ink-500">Cadastre a equipe abaixo e clique em “Criar central”.</p>
            </div>
          </div>
        )}

        <section>
          <h3 className="text-sm font-bold text-ink-900">Equipe de vendas</h3>
          <p className="mt-1 text-xs text-ink-500">
            Cada pessoa recebe um convite por e-mail do Chatwoot para definir a própria senha.
          </p>

          <form onSubmit={addPerson} className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <Input placeholder="Nome do vendedor" value={name} onChange={(e) => setName(e.target.value)} />
            <Input type="email" placeholder="email@loja.com.br" value={email} onChange={(e) => setEmail(e.target.value)} />
            <div className="flex gap-2">
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as SalespersonRole)}
                className="rounded-2xl border border-ink-200 bg-white px-3 text-sm focus:border-brand-500 focus:outline-none"
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
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void provision()} loading={provisioning} icon={<ChatIcon className="size-4" />}>
            {provisioned ? 'Sincronizar equipe na central' : 'Criar central e convidar equipe'}
          </Button>
          <span className="text-xs text-ink-400">
            Usa a chave Super Admin do Chatwoot, guardada apenas no servidor.
          </span>
        </div>

        {error && (
          <div className="space-y-2">
            <InfoNote tone="red">{error.message}</InfoNote>
            {error.hint && <InfoNote tone="amber">{error.hint}</InfoNote>}
          </div>
        )}
      </div>
    </StepCard>
  )
}
