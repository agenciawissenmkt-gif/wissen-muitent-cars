import { useState } from 'react'
import { motion } from 'framer-motion'
import { useAuth } from '../core/auth'
import { Button } from '../ui/Button'
import { Logo } from '../ui/Logo'
import { CalendarIcon, CarIcon, GoogleIcon, SparkIcon, WhatsappIcon } from '../ui/icons'

const HIGHLIGHTS = [
  { icon: <CarIcon />, title: 'Estoque vivo', text: 'Cadastre o veículo com foto e a IA já sabe vender.' },
  { icon: <WhatsappIcon />, title: 'WhatsApp 24h', text: 'Atendimento automático conectado ao seu número.' },
  { icon: <CalendarIcon />, title: 'Agenda cheia', text: 'Visitas e test-drives marcados direto no Google Agenda.' },
]

export function Login() {
  const { signInWithGoogle } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleLogin() {
    setLoading(true)
    setError(null)
    try {
      await signInWithGoogle()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível entrar com o Google.')
      setLoading(false)
    }
  }

  return (
    <div className="grid min-h-full lg:grid-cols-[1.05fr_1fr]">
      {/* Painel de marca */}
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-brand-700 via-brand-600 to-brand-900 p-12 lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-20 size-96 rounded-full bg-brand-400/20 blur-3xl" />

        <div className="relative">
          <span className="flex items-center gap-3 text-white">
            <span className="grid size-10 place-items-center rounded-2xl bg-white/15 backdrop-blur">
              <svg viewBox="0 0 24 24" className="size-5" fill="none" aria-hidden="true">
                <path d="M3 6.5 6 17l3-7 3 7 3-10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="19" cy="8" r="2" fill="currentColor" />
              </svg>
            </span>
            <span className="leading-tight">
              <span className="block text-[0.95rem] font-extrabold tracking-[0.18em]">WISSEN</span>
              <span className="block text-[0.7rem] font-bold tracking-[0.42em] text-brand-200">CARS</span>
            </span>
          </span>
        </div>

        <div className="relative">
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="max-w-md text-4xl font-extrabold leading-[1.15] text-white"
          >
            Sua loja de veículos vendendo <span className="text-emerald-300">no automático</span>.
          </motion.h1>
          <p className="mt-4 max-w-md text-brand-100/90">
            Gerencie o estoque, conecte o WhatsApp e deixe o agente de IA atender, apresentar carros e agendar visitas
            enquanto sua equipe fecha negócio.
          </p>

          <ul className="mt-10 space-y-4">
            {HIGHLIGHTS.map((item, index) => (
              <motion.li
                key={item.title}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.15 + index * 0.1 }}
                className="flex items-start gap-4 text-white"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/15 backdrop-blur">
                  {item.icon}
                </span>
                <span>
                  <span className="block text-sm font-bold">{item.title}</span>
                  <span className="block text-sm text-brand-100/80">{item.text}</span>
                </span>
              </motion.li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-brand-200/70">Wissen Cars — plataforma de atendimento inteligente.</p>
      </div>

      {/* Card de acesso */}
      <div className="flex items-center justify-center bg-white p-6 sm:p-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-sm"
        >
          <div className="lg:hidden">
            <Logo />
          </div>

          <span className="mt-8 inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700 lg:mt-0">
            <SparkIcon className="size-3.5" />
            Acesso do lojista
          </span>

          <h2 className="mt-4 text-2xl font-extrabold text-ink-900">Entrar na plataforma</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-500">
            O acesso é exclusivo pela sua conta Google. Sem senha para lembrar, sem cadastro extra.
          </p>

          <Button
            onClick={handleLogin}
            loading={loading}
            variant="secondary"
            size="lg"
            className="mt-8 w-full"
            icon={loading ? undefined : <GoogleIcon />}
          >
            Entrar com o Google
          </Button>

          {error && (
            <p className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
          )}

          <p className="mt-8 text-xs leading-relaxed text-ink-400">
            Ao continuar você concorda com os termos de uso da plataforma. Usamos sua conta Google apenas para
            identificar sua loja e, se você autorizar na etapa de implementação, para gerenciar a agenda de visitas.
          </p>
        </motion.div>
      </div>
    </div>
  )
}
