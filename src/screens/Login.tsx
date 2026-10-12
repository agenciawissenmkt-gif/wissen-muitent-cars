import { useState } from 'react'
import { motion } from 'framer-motion'
import { useAuth } from '../core/auth'
import { ACCESS_ERROR_TEXT, initialAccessError } from '../core/access'
import { Button } from '../ui/Button'
import { Logo } from '../ui/Logo'
import { CalendarIcon, CarIcon, GoogleIcon, SparkIcon, WhatsappIcon } from '../ui/icons'
import { useDemoEntrada } from '../demo/DemoEntrada'
import { WissenMark } from '../ui/brand'

const HIGHLIGHTS = [
  { icon: <CarIcon />, title: 'Estoque vivo', text: 'Cadastre o veículo com foto e a IA já sabe vender.' },
  { icon: <WhatsappIcon />, title: 'WhatsApp 24h', text: 'Atendimento automático conectado ao seu número.' },
  { icon: <CalendarIcon />, title: 'Agenda cheia', text: 'Visitas e test-drives marcados direto no Google Agenda.' },
]

export function Login() {
  const { signInWithGoogle } = useAuth()
  const demo = useDemoEntrada()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(initialAccessError ? ACCESS_ERROR_TEXT[initialAccessError] : null)

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
          <Logo light />
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
          {demo.erro && (
            <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{demo.erro}</p>
          )}

          <p className="mt-8 text-xs leading-relaxed text-ink-400">
            Ao continuar você concorda com os termos de uso da plataforma. Usamos sua conta Google apenas para
            identificar sua loja e, se você autorizar na etapa de implementação, para gerenciar a agenda de visitas.
          </p>
        </motion.div>
      </div>

      {/* Demonstração: entra direto num painel de exemplo, sem login e sem gravar nada. */}
      <motion.button
        type="button"
        onClick={demo.entrar}
        aria-label="Wissen Cars: demonstração do painel"
        title="Entrar na demonstração do painel"
        initial={{ opacity: 0, y: 16, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: 0.6, type: 'spring', stiffness: 260, damping: 22 }}
        className="group fixed bottom-5 right-5 z-40 inline-flex items-center gap-4 overflow-hidden rounded-[1.35rem] bg-gradient-to-br from-[#7c3aed] via-[#5b1a96] to-[#3a0d62] py-3.5 pl-3.5 pr-7 text-left text-white shadow-2xl shadow-[#3a0d62]/40 ring-1 ring-white/15 transition hover:-translate-y-1 hover:shadow-[#3a0d62]/55 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 sm:bottom-8 sm:right-8"
      >
        {/* brilho que passa no hover */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 -skew-x-12 bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-0 transition-all duration-700 group-hover:left-full group-hover:opacity-100"
        />
        <span className="relative grid size-14 shrink-0 place-items-center rounded-2xl bg-white shadow-lg shadow-black/20 transition duration-300 group-hover:scale-105 group-hover:rotate-[-4deg]">
          <WissenMark className="w-9 text-[#5b1a96]" />
        </span>
        <span className="relative flex flex-col leading-none">
          <span className="text-lg font-extrabold tracking-tight">Wissen Cars</span>
          <span className="mt-1.5 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-100">
            Demonstração
            <svg viewBox="0 0 20 20" className="size-4 transition group-hover:translate-x-0.5" fill="currentColor" aria-hidden>
              <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.17 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z" />
            </svg>
          </span>
        </span>
      </motion.button>
    </div>
  )
}
