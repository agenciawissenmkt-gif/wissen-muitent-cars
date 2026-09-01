import { useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useAuth } from '../core/auth'
import { useTenant } from '../core/tenant'
import { Logo } from '../ui/Logo'
import { Spinner } from '../ui/Button'
import { CarIcon, ChartIcon, LogoutIcon, MenuIcon, SettingsIcon } from '../ui/icons'

interface NavItem {
  to: string
  label: string
  icon: ReactNode
}

/** Ordem fixa do menu: Estoque, Visão Geral e Implementação por último. */
const NAV: NavItem[] = [
  { to: '/estoque', label: 'Estoque de Veículos', icon: <CarIcon /> },
  { to: '/visao-geral', label: 'Visão Geral', icon: <ChartIcon /> },
  { to: '/implementacao', label: 'Implementação', icon: <SettingsIcon /> },
]

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  const { store } = useTenant()
  const pendingOnboarding = store ? store.onboarding_step !== 'concluido' : false

  return (
    <nav className="flex flex-col gap-1">
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          onClick={onNavigate}
          className={({ isActive }) =>
            `group relative flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold transition-all ${
              isActive ? 'bg-brand-600 text-white shadow-lg shadow-brand-600/25' : 'text-ink-500 hover:bg-ink-100 hover:text-ink-900'
            }`
          }
        >
          {item.icon}
          <span className="flex-1">{item.label}</span>
          {item.to === '/implementacao' && pendingOnboarding && (
            <span className="size-2 rounded-full bg-amber-400 ring-4 ring-amber-400/20" title="Implementação pendente" />
          )}
        </NavLink>
      ))}
    </nav>
  )
}

function UserCard() {
  const { user, signOut } = useAuth()
  const { store } = useTenant()
  const name = (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? ''
  const avatar = user?.user_metadata?.avatar_url as string | undefined

  return (
    <div className="rounded-2xl border border-ink-100 bg-ink-50/70 p-3">
      <div className="flex items-center gap-3">
        {avatar ? (
          <img src={avatar} alt="" className="size-9 rounded-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          <span className="grid size-9 place-items-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
            {name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold text-ink-900">{store?.name?.trim() || 'Minha loja'}</span>
          <span className="block truncate text-xs text-ink-500">{user?.email}</span>
        </span>
        <button
          type="button"
          onClick={() => void signOut()}
          title="Sair"
          aria-label="Sair"
          className="grid size-8 shrink-0 place-items-center rounded-xl text-ink-400 transition-colors hover:bg-white hover:text-red-600"
        >
          <LogoutIcon className="size-4" />
        </button>
      </div>
    </div>
  )
}

export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false)
  const { loading, error } = useTenant()
  const location = useLocation()

  return (
    <div className="flex min-h-full bg-ink-50/60">
      {/* Sidebar desktop */}
      <aside className="sticky top-0 hidden h-screen w-72 shrink-0 flex-col justify-between border-r border-ink-100 bg-white px-5 py-6 lg:flex">
        <div>
          <div className="px-1">
            <Logo />
          </div>
          <div className="mt-8">
            <NavItems />
          </div>
        </div>
        <UserCard />
      </aside>

      {/* Topo mobile */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-ink-100 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
          <Logo />
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Abrir menu"
            className="grid size-10 place-items-center rounded-2xl border border-ink-200 text-ink-700"
          >
            <MenuIcon />
          </button>
        </header>

        <AnimatePresence>
          {menuOpen && (
            <div className="fixed inset-0 z-50 lg:hidden">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setMenuOpen(false)}
                className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm"
              />
              <motion.aside
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ type: 'spring', duration: 0.4, bounce: 0 }}
                className="relative flex h-full w-72 flex-col justify-between bg-white px-5 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
              >
                <div>
                  <Logo />
                  <div className="mt-8">
                    <NavItems onNavigate={() => setMenuOpen(false)} />
                  </div>
                </div>
                <UserCard />
              </motion.aside>
            </div>
          )}
        </AnimatePresence>

        <main className="flex-1">
          {loading ? (
            <div className="grid h-[60vh] place-items-center text-brand-600">
              <Spinner className="size-8" />
            </div>
          ) : error ? (
            <div className="mx-auto max-w-2xl p-6">
              <div className="rounded-3xl border border-red-200 bg-red-50 p-6">
                <h2 className="text-base font-bold text-red-800">Não foi possível carregar sua loja</h2>
                <p className="mt-2 text-sm text-red-700">{error}</p>
                <p className="mt-3 text-xs text-red-600">
                  Verifique se a migração <code className="font-mono">supabase/migrations/0002_app_layer.sql</code> foi
                  aplicada no seu projeto Supabase.
                </p>
              </div>
            </div>
          ) : (
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
            >
              <Outlet />
            </motion.div>
          )}
        </main>
      </div>
    </div>
  )
}
