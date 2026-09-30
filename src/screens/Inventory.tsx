import { useMemo, useState } from 'react'
import { useTenant } from '../core/tenant'
import { CAR_STATUS_LABEL, hasPendingReservation, type Car, type CarStatus } from '../core/types'
import { Button } from '../ui/Button'
import { EmptyState, SkeletonCard, useToast } from '../ui/Feedback'
import { Modal } from '../ui/Modal'
import { CarIcon, PlusIcon, SearchIcon } from '../ui/icons'
import { CarCard } from './inventory/CarCard'
import { CarFormModal } from './inventory/CarFormModal'
import { useCars } from './inventory/useCars'

type Filter = 'todos' | 'solicitada' | Exclude<CarStatus, 'vendido'>

// Carro vendido sai do painel: fica no banco só para os relatórios de vendas.
// "Reserva solicitada" não é status: é o pedido que o cliente fez no WhatsApp e que
// ainda não virou sinal -- o carro continua Disponível até o vendedor tocar em Deu sinal.
const FILTERS: Filter[] = ['todos', 'ativo', 'solicitada', 'reservado']

const FILTER_LABEL = (item: Filter) =>
  item === 'todos' ? 'Todos' : item === 'solicitada' ? 'Reserva solicitada' : CAR_STATUS_LABEL[item]

export function Inventory() {
  const { store } = useTenant()
  const { toast } = useToast()
  const { cars: allCars, loading, error, saveCar, deleteCar, markSold, toggleDeposit, cancelReservationRequest } = useCars({
    tenantId: store?.tenant_id ?? undefined,
    storeId: store?.id,
  })

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('todos')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Car | null>(null)
  const [deleting, setDeleting] = useState<Car | null>(null)
  const [deletingBusy, setDeletingBusy] = useState(false)
  const [selling, setSelling] = useState<Car | null>(null)
  const [sellingBusy, setSellingBusy] = useState(false)
  const [depositBusy, setDepositBusy] = useState<string | null>(null)

  const cars = useMemo(() => allCars.filter((car) => car.status !== 'vendido'), [allCars])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return cars.filter((car) => {
      const matchesStatus =
        filter === 'todos' || (filter === 'solicitada' ? hasPendingReservation(car) : car.status === filter)
      if (!matchesStatus) return false
      if (!term) return true
      return `${car.brand ?? ''} ${car.model} ${car.version ?? ''} ${car.color ?? ''}`.toLowerCase().includes(term)
    })
  }, [cars, search, filter])

  const counts = useMemo(() => {
    return {
      todos: cars.length,
      ativo: cars.filter((car) => car.status === 'ativo').length,
      solicitada: cars.filter((car) => hasPendingReservation(car)).length,
      reservado: cars.filter((car) => car.status === 'reservado').length,
    } as Record<Filter, number>
  }, [cars])

  function openNew() {
    setEditing(null)
    setFormOpen(true)
  }

  function openEdit(car: Car) {
    setEditing(car)
    setFormOpen(true)
  }

  async function confirmSold() {
    if (!selling) return
    setSellingBusy(true)
    try {
      await markSold(selling)
      toast('Parabéns pela venda! O carro saiu do painel e a IA não oferece mais.')
      setSelling(null)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não foi possível marcar como vendido.', 'error')
    } finally {
      setSellingBusy(false)
    }
  }

  async function handleDeposit(car: Car) {
    setDepositBusy(car.id)
    try {
      const next = await toggleDeposit(car)
      toast(
        next === 'reservado'
          ? 'Sinal registrado. A IA não oferece mais este carro; ele continua no painel.'
          : 'Venda retomada. O carro voltou a ficar disponível para a IA.',
      )
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não foi possível atualizar o carro.', 'error')
    } finally {
      setDepositBusy(null)
    }
  }

  async function handleCancelRequest(car: Car) {
    setDepositBusy(car.id)
    try {
      await cancelReservationRequest(car)
      toast('Pedido de reserva cancelado. O carro segue disponível.')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não foi possível cancelar o pedido.', 'error')
    } finally {
      setDepositBusy(null)
    }
  }

  async function confirmDelete() {
    if (!deleting) return
    setDeletingBusy(true)
    try {
      await deleteCar(deleting)
      toast('Anúncio excluído.')
      setDeleting(null)
      setFormOpen(false)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não foi possível excluir o veículo.', 'error')
    } finally {
      setDeletingBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-ink-900 sm:text-3xl">Estoque de Veículos</h1>
          <p className="mt-1 text-sm text-ink-500">
            Tudo o que você cadastrar aqui é o que a IA usa para atender no WhatsApp.
          </p>
        </div>
        <Button onClick={openNew} icon={<PlusIcon />}>
          Cadastrar veículo
        </Button>
      </header>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por marca, modelo, versão ou cor…"
            className="w-full rounded-2xl border border-ink-200 bg-white py-3 pl-11 pr-4 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/10"
          />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {FILTERS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setFilter(item)}
              className={`shrink-0 rounded-2xl border px-4 py-2.5 text-sm font-semibold transition-all ${
                filter === item
                  ? 'border-brand-600 bg-brand-600 text-white shadow-md shadow-brand-600/20'
                  : 'border-ink-200 bg-white text-ink-600 hover:border-brand-300 hover:text-brand-700'
              }`}
            >
              {FILTER_LABEL(item)}
              <span className={`ml-2 text-xs ${filter === item ? 'text-white/70' : 'text-ink-400'}`}>{counts[item]}</span>
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      <div className="mt-6">
        {loading ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <SkeletonCard key={index} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<CarIcon className="size-7" />}
            title={cars.length === 0 ? 'Seu estoque está vazio' : 'Nenhum veículo encontrado'}
            description={
              cars.length === 0
                ? 'Cadastre o primeiro veículo com fotos e ficha técnica para o agente de IA começar a vender.'
                : 'Tente outro termo de busca ou remova o filtro de status.'
            }
            action={
              cars.length === 0 ? (
                <Button onClick={openNew} icon={<PlusIcon />}>
                  Cadastrar veículo
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((car) => (
              <CarCard
                key={car.id}
                car={car}
                onEdit={openEdit}
                onSold={setSelling}
                onDeposit={(c) => void handleDeposit(c)}
                onCancelRequest={(c) => void handleCancelRequest(c)}
                busy={depositBusy === car.id}
              />
            ))}
          </div>
        )}
      </div>

      <CarFormModal
        open={formOpen}
        car={editing}
        onClose={() => setFormOpen(false)}
        onDelete={(car) => setDeleting(car)}
        onSave={async (draft, photos, carId) => {
          const id = await saveCar(draft, photos, carId)
          toast(carId ? 'Anúncio atualizado com sucesso.' : 'Veículo cadastrado no estoque.')
          return id
        }}
      />

      <Modal
        open={Boolean(selling)}
        onClose={() => setSelling(null)}
        size="md"
        title="Tem certeza que este carro foi vendido?"
        subtitle="Esta ação não pode ser desfeita."
        footer={
          <>
            <Button variant="ghost" onClick={() => setSelling(null)} disabled={sellingBusy}>
              Cancelar
            </Button>
            <Button variant="success" onClick={() => void confirmSold()} loading={sellingBusy}>
              Sim, foi vendido
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-ink-600">
          O <strong className="text-ink-900">{[selling?.brand, selling?.model].filter(Boolean).join(' ')}</strong> sai do
          painel, as fotos dele são apagadas e a IA deixa de oferecer. A venda entra no relatório semanal da loja.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-ink-500">
          O cliente só deu sinal e ainda pode desistir? Use o botão <strong className="text-blue-900">Deu sinal</strong>: o carro
          fica guardado no painel e pode voltar a ficar disponível.
        </p>
      </Modal>

      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        size="md"
        title="Excluir anúncio"
        subtitle="Esta ação não pode ser desfeita."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)} disabled={deletingBusy}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={() => void confirmDelete()} loading={deletingBusy}>
              Excluir definitivamente
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-ink-600">
          O anúncio{' '}
          <strong className="text-ink-900">{[deleting?.brand, deleting?.model].filter(Boolean).join(' ')}</strong> e
          todas as suas fotos
          serão apagados. Use só para cadastro errado: se o carro foi vendido, use o botão Vendido, para a venda contar no
          relatório.
        </p>
      </Modal>
    </div>
  )
}
