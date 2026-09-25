import { WissenMark, WissenWordmark } from './brand'

export function Logo({ compact = false, light = false }: { compact?: boolean; light?: boolean }) {
  return (
    <span className="flex items-center gap-3">
      <span
        className={
          light
            ? 'grid size-10 shrink-0 place-items-center rounded-2xl bg-white/15 ring-1 ring-white/20 backdrop-blur'
            : 'grid size-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[#5b1a96] to-[#3a0d62] shadow-lg shadow-[#471174]/25'
        }
      >
        <WissenMark className="w-[1.55rem] text-white" />
      </span>
      {!compact && (
        <span className="flex flex-col gap-[0.4rem] leading-none">
          <WissenWordmark title="Wissen" className={`h-[0.85rem] w-auto self-start ${light ? 'text-white' : 'text-[#471174]'}`} />
          <span className={`block text-[0.62rem] font-bold tracking-[0.42em] ${light ? 'text-brand-200' : 'text-brand-600'}`}>CARS</span>
        </span>
      )}
    </span>
  )
}
