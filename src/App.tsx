import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './core/auth'
import { TenantProvider } from './core/tenant'
import { isSupabaseConfigured } from './core/supabase'
import { ToastProvider } from './ui/Feedback'
import { Spinner } from './ui/Button'
import { Logo } from './ui/Logo'
import { AppShell } from './screens/AppShell'
import { Login } from './screens/Login'
import { Inventory } from './screens/Inventory'
import { Overview } from './screens/Overview'
import { Implementation } from './screens/Implementation'

function SetupNotice() {
  return (
    <div className="grid min-h-full place-items-center bg-ink-50 p-6">
      <div className="w-full max-w-lg rounded-3xl border border-ink-200 bg-white p-8 shadow-xl">
        <Logo />
        <h1 className="mt-6 text-xl font-bold text-ink-900">Configuração pendente</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-500">
          Crie um arquivo <code className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-xs">.env</code> na raiz do
          projeto (use o <code className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-xs">.env.example</code> como
          base) com as chaves do seu projeto Supabase:
        </p>
        <pre className="mt-4 overflow-x-auto rounded-2xl bg-ink-900 p-4 text-xs leading-relaxed text-ink-100">
          {`VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...`}
        </pre>
        <p className="mt-4 text-sm text-ink-500">Depois reinicie o servidor de desenvolvimento.</p>
      </div>
    </div>
  )
}

function Gate() {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div className="grid min-h-full place-items-center text-brand-600">
        <Spinner className="size-8" />
      </div>
    )
  }

  if (!session) return <Login />

  return (
    <TenantProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/estoque" element={<Inventory />} />
          <Route path="/visao-geral" element={<Overview />} />
          <Route path="/implementacao" element={<Implementation />} />
          <Route path="*" element={<Navigate to="/estoque" replace />} />
        </Route>
      </Routes>
    </TenantProvider>
  )
}

export default function App() {
  if (!isSupabaseConfigured) return <SetupNotice />

  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Gate />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  )
}
