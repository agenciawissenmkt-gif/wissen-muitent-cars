import confetti from 'canvas-confetti'

const BRAND_COLORS = ['#7C3AED', '#9333EA', '#6B21A8', '#10B981', '#FFFFFF']

/** Fogos de artifício exibidos quando o WhatsApp da loja conecta. */
export function celebrate() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  // Estouro inicial
  confetti({ particleCount: 140, spread: 80, origin: { y: 0.6 }, colors: BRAND_COLORS })

  // Fogos laterais por ~2,5s
  const end = Date.now() + 2500
  const frame = () => {
    confetti({
      particleCount: 4,
      angle: 60,
      spread: 70,
      origin: { x: 0, y: 0.7 },
      colors: BRAND_COLORS,
      startVelocity: 45,
    })
    confetti({
      particleCount: 4,
      angle: 120,
      spread: 70,
      origin: { x: 1, y: 0.7 },
      colors: BRAND_COLORS,
      startVelocity: 45,
    })
    if (Date.now() < end) requestAnimationFrame(frame)
  }
  frame()

  // Bouquet final
  setTimeout(() => {
    confetti({ particleCount: 90, spread: 120, startVelocity: 55, origin: { y: 0.4 }, colors: BRAND_COLORS })
  }, 900)
}
