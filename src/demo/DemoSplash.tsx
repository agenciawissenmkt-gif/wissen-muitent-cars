import { useEffect, useMemo, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { WissenMark, WissenWordmark } from '../ui/brand'

/**
 * Abertura da demonstração: o "W" da Wissen em 3D (camadas empilhadas girando),
 * anéis de luz, o nome entrando e uma barra de progresso de uns 4 segundos
 * enquanto a cópia da loja modelo carrega.
 */

const CAMADAS = 14
const ETAPAS = ['Carregando o estoque da loja modelo', 'Preparando a IA da ficha técnica', 'Montando a implementação', 'Tudo pronto']

export function DemoSplash({ duracaoMs = 4200, pronto }: { duracaoMs?: number; pronto: boolean }) {
  const reduzir = useReducedMotion()
  const [progresso, setProgresso] = useState(0)

  useEffect(() => {
    const inicio = performance.now()
    let quadro = 0
    const passo = (agora: number) => {
      const t = Math.min(1, (agora - inicio) / duracaoMs)
      // Segura em 92% enquanto a loja modelo nao chegou.
      const alvo = pronto ? t : Math.min(t, 0.92)
      setProgresso((p) => Math.max(p, alvo))
      if (t < 1 || !pronto) quadro = requestAnimationFrame(passo)
    }
    quadro = requestAnimationFrame(passo)
    return () => cancelAnimationFrame(quadro)
  }, [duracaoMs, pronto])

  const etapa = ETAPAS[Math.min(ETAPAS.length - 1, Math.floor(progresso * ETAPAS.length))]

  const particulas = useMemo(
    () =>
      Array.from({ length: 28 }, (_, i) => ({
        id: i,
        x: (i * 37) % 100,
        atraso: (i % 7) * 0.35,
        tam: 2 + (i % 3),
        dur: 3.5 + (i % 5) * 0.6,
      })),
    [],
  )

  return (
    <div className="fixed inset-0 z-[100] overflow-hidden bg-[#12041f] text-white">
      {/* brilho de fundo */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(124,58,237,0.45),transparent_60%)]" />
      <div className="pointer-events-none absolute -left-40 top-1/4 size-[28rem] rounded-full bg-fuchsia-600/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-40 bottom-0 size-[30rem] rounded-full bg-indigo-600/25 blur-3xl" />

      {/* piso em perspectiva */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 [perspective:600px]">
        <motion.div
          className="absolute inset-x-[-50%] bottom-[-20%] h-[140%] origin-bottom bg-[linear-gradient(rgba(167,139,250,0.25)_1px,transparent_1px),linear-gradient(90deg,rgba(167,139,250,0.25)_1px,transparent_1px)] bg-[size:48px_48px] [transform:rotateX(68deg)] [mask-image:linear-gradient(to_top,black,transparent)]"
          animate={reduzir ? undefined : { backgroundPositionY: ['0px', '48px'] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
        />
      </div>

      {/* particulas subindo */}
      {!reduzir &&
        particulas.map((p) => (
          <motion.span
            key={p.id}
            className="pointer-events-none absolute bottom-0 rounded-full bg-brand-300/70 shadow-[0_0_12px_rgba(196,181,253,0.9)]"
            style={{ left: `${p.x}%`, width: p.tam, height: p.tam }}
            initial={{ y: 0, opacity: 0 }}
            animate={{ y: '-100vh', opacity: [0, 1, 0] }}
            transition={{ duration: p.dur, delay: p.atraso, repeat: Infinity, ease: 'easeOut' }}
          />
        ))}

      <div className="relative flex h-full flex-col items-center justify-center px-6">
        {/* W em 3D */}
        <div className="relative grid size-56 place-items-center [perspective:900px] sm:size-64">
          {/* aneis */}
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="absolute rounded-full border border-brand-300/30"
              style={{ width: `${100 + i * 22}%`, height: `${100 + i * 22}%` }}
              animate={reduzir ? undefined : { rotateX: [70, 70], rotateZ: [0, i % 2 ? -360 : 360] }}
              transition={{ duration: 8 + i * 3, repeat: Infinity, ease: 'linear' }}
            />
          ))}
          <motion.div
            className="relative size-40 [transform-style:preserve-3d] sm:size-44"
            initial={{ scale: 0.4, opacity: 0, rotateX: 25 }}
            animate={
              reduzir
                ? { scale: 1, opacity: 1 }
                : { scale: 1, opacity: 1, rotateY: [0, 360], rotateX: [18, -12, 18] }
            }
            transition={{
              scale: { duration: 0.9, ease: [0.16, 1, 0.3, 1] },
              opacity: { duration: 0.6 },
              rotateY: { duration: 3.6, repeat: Infinity, ease: 'linear' },
              rotateX: { duration: 3.6, repeat: Infinity, ease: 'easeInOut' },
            }}
          >
            {Array.from({ length: CAMADAS }, (_, i) => {
              const frente = i === CAMADAS - 1
              return (
                <span
                  key={i}
                  className="absolute inset-0 grid place-items-center"
                  style={{ transform: `translateZ(${(i - CAMADAS / 2) * 1.6}px)` }}
                >
                  <WissenMark
                    className={
                      frente
                        ? 'w-full text-white drop-shadow-[0_0_18px_rgba(196,181,253,0.95)]'
                        : 'w-full text-[#5b1a96]'
                    }
                  />
                </span>
              )
            })}
            {/* verso tambem branco, para o giro nao mostrar o lado "vazio" */}
            <span className="absolute inset-0 grid place-items-center" style={{ transform: `translateZ(${(-CAMADAS / 2 - 1) * 1.6}px) rotateY(180deg)` }}>
              <WissenMark className="w-full text-white/90" />
            </span>
          </motion.div>
          {/* reflexo no chao */}
          <div className="absolute -bottom-6 h-6 w-40 rounded-[50%] bg-brand-400/40 blur-xl" />
        </div>

        {/* nome */}
        <motion.div
          className="mt-14 flex flex-col items-center gap-3"
          initial={{ opacity: 0, y: 14, filter: 'blur(8px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ delay: 0.5, duration: 0.8 }}
        >
          <WissenWordmark title="Wissen" className="h-7 w-auto text-white sm:h-8" />
          <div className="flex gap-[0.6em] text-sm font-extrabold text-brand-200">
            {'CARS'.split('').map((letra, i) => (
              <motion.span
                key={i}
                initial={{ opacity: 0, rotateX: -90, y: 8 }}
                animate={{ opacity: 1, rotateX: 0, y: 0 }}
                transition={{ delay: 0.9 + i * 0.12, type: 'spring', stiffness: 260, damping: 18 }}
              >
                {letra}
              </motion.span>
            ))}
          </div>
        </motion.div>

        <motion.span
          className="mt-6 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[0.7rem] font-bold uppercase tracking-[0.25em] text-brand-100 backdrop-blur"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.3 }}
        >
          Demonstração do painel
        </motion.span>

        {/* progresso */}
        <div className="mt-10 w-full max-w-xs">
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-fuchsia-400 via-brand-400 to-indigo-300 shadow-[0_0_14px_rgba(167,139,250,0.9)]"
              style={{ width: `${Math.round(progresso * 100)}%` }}
            />
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-brand-100/80">
            <motion.span key={etapa} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
              {etapa}…
            </motion.span>
            <span className="tabular-nums">{Math.round(progresso * 100)}%</span>
          </div>
        </div>
      </div>
    </div>
  )
}
