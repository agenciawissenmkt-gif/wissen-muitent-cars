const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
})

const brlCompact = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
})

export function formatBRL(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return 'Sob consulta'
  return brl.format(value)
}

export function formatBRLCompact(value: number): string {
  return brlCompact.format(value || 0)
}

export function formatKm(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return `${new Intl.NumberFormat('pt-BR').format(value)} km`
}

export function formatYear(year: number | null, modelYear: number | null): string {
  if (!year && !modelYear) return '—'
  if (year && modelYear && year !== modelYear) return `${year}/${modelYear}`
  return String(modelYear ?? year)
}

/** "Auto Wissen Motors" -> "auto-wissen-motors" */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

/** Mantém só dígitos — usado em telefone e CNPJ antes de salvar. */
export function onlyDigits(value: string): string {
  return value.replace(/\D+/g, '')
}

export function maskPhone(value: string): string {
  const d = onlyDigits(value).slice(0, 11)
  if (d.length <= 2) return d
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

export function maskCnpj(value: string): string {
  const d = onlyDigits(value).slice(0, 14)
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2')
}

/** Telefone brasileiro no formato exigido pela Evolution API: 55 + DDD + número. */
export function toWhatsappNumber(value: string): string {
  const d = onlyDigits(value)
  return d.startsWith('55') ? d : `55${d}`
}
