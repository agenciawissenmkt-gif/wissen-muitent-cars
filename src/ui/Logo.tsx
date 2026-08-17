export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 text-white shadow-lg shadow-brand-600/25">
        <svg viewBox="0 0 24 24" className="size-5" fill="none" aria-hidden="true">
          <path
            d="M3 6.5 6 17l3-7 3 7 3-10"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="19" cy="8" r="2" fill="currentColor" />
        </svg>
      </span>
      {!compact && (
        <span className="leading-tight">
          <span className="block text-[0.95rem] font-extrabold tracking-[0.18em] text-ink-900">WISSEN</span>
          <span className="block text-[0.7rem] font-bold tracking-[0.42em] text-brand-600">CARS</span>
        </span>
      )}
    </span>
  )
}
