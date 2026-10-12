import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { demoPedida, iniciarDemo, isDemo } from './demo'
import { DemoSplash } from './DemoSplash'

type Fase = 'real' | 'abrindo' | 'demo'

interface DemoEntradaValue {
  fase: Fase
  /** Erro ao abrir a demonstracao (aparece na tela de login). */
  erro: string | null
  entrar: () => void
}

const Ctx = createContext<DemoEntradaValue>({ fase: 'real', erro: null, entrar: () => undefined })

export const useDemoEntrada = () => useContext(Ctx)

const DURACAO_ABERTURA = 4200

/**
 * Controla a passagem login -> demonstracao: abertura animada enquanto a copia
 * da loja modelo carrega, e so depois o painel. `children` recebe a fase para
 * remontar a autenticacao ja no modo certo.
 */
export function DemoEntrada({ children }: { children: (fase: Fase) => ReactNode }) {
  const [fase, setFase] = useState<Fase>(() => (isDemo() ? 'demo' : demoPedida() ? 'abrindo' : 'real'))
  const [erro, setErro] = useState<string | null>(null)
  const [carregou, setCarregou] = useState(false)

  const entrar = useCallback(() => {
    setErro(null)
    setCarregou(false)
    setFase('abrindo')
  }, [])

  useEffect(() => {
    if (fase !== 'abrindo') return
    let vivo = true
    const inicio = Date.now()
    iniciarDemo()
      .then(async () => {
        if (!vivo) return
        setCarregou(true)
        const falta = DURACAO_ABERTURA - (Date.now() - inicio)
        if (falta > 0) await new Promise((r) => setTimeout(r, falta + 250))
        if (!vivo) return
        setFase('demo')
      })
      .catch((e: unknown) => {
        if (!vivo) return
        setErro(e instanceof Error ? e.message : 'Não foi possível abrir a demonstração agora.')
        setFase('real')
      })
    return () => {
      vivo = false
    }
  }, [fase])

  return (
    <Ctx.Provider value={{ fase, erro, entrar }}>
      {fase === 'abrindo' ? null : children(fase)}
      <AnimatePresence>
        {fase === 'abrindo' && (
          <motion.div key="abertura" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 1.04 }} transition={{ duration: 0.45 }}>
            <DemoSplash duracaoMs={DURACAO_ABERTURA} pronto={carregou} />
          </motion.div>
        )}
      </AnimatePresence>
    </Ctx.Provider>
  )
}
