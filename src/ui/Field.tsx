import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'

const CONTROL =
  'w-full rounded-2xl border border-ink-200 bg-white px-4 py-3 text-sm text-ink-900 placeholder:text-ink-400 transition-colors focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/10 disabled:bg-ink-50 disabled:text-ink-400'

interface LabelProps {
  label?: string
  hint?: string
  error?: string
  required?: boolean
  children: ReactNode
  htmlFor?: string
  className?: string
}

export function Field({ label, hint, error, required, children, htmlFor, className = '' }: LabelProps) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label && (
        <label htmlFor={htmlFor} className="text-xs font-semibold uppercase tracking-wide text-ink-500">
          {label}
          {required && <span className="ml-0.5 text-brand-600">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="text-xs font-medium text-red-600">{error}</p>
      ) : hint ? (
        <p className="text-xs text-ink-400">{hint}</p>
      ) : null}
    </div>
  )
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  hint?: string
  error?: string
  prefix?: string
}

export function Input({ label, hint, error, prefix, className = '', ...rest }: InputProps) {
  const id = useId()
  return (
    <Field label={label} hint={hint} error={error} required={rest.required} htmlFor={id}>
      <div className="relative">
        {prefix && (
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-medium text-ink-400">
            {prefix}
          </span>
        )}
        <input
          id={id}
          {...rest}
          className={`${CONTROL} ${prefix ? 'pl-11' : ''} ${error ? 'border-red-300' : ''} ${className}`}
        />
      </div>
    </Field>
  )
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  hint?: string
  error?: string
  options: readonly string[]
  placeholder?: string
}

export function Select({ label, hint, error, options, placeholder, className = '', ...rest }: SelectProps) {
  const id = useId()
  return (
    <Field label={label} hint={hint} error={error} required={rest.required} htmlFor={id}>
      <select id={id} {...rest} className={`${CONTROL} appearance-none bg-[length:1rem] pr-10 ${className}`}>
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </Field>
  )
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  hint?: string
  error?: string
}

export function Textarea({ label, hint, error, className = '', ...rest }: TextareaProps) {
  const id = useId()
  return (
    <Field label={label} hint={hint} error={error} required={rest.required} htmlFor={id}>
      <textarea id={id} {...rest} className={`${CONTROL} min-h-28 resize-y leading-relaxed ${className}`} />
    </Field>
  )
}

interface ToggleProps {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  description?: string
}

export function Toggle({ checked, onChange, label, description }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition-all ${
        checked ? 'border-brand-200 bg-brand-50' : 'border-ink-200 bg-white hover:border-ink-300'
      }`}
    >
      <span
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-brand-600' : 'bg-ink-200'
        }`}
      >
        <span
          className={`absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-all ${
            checked ? 'left-[1.375rem]' : 'left-0.5'
          }`}
        />
      </span>
      <span className="flex-1">
        <span className="block text-sm font-semibold text-ink-900">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-ink-500">{description}</span>}
      </span>
    </button>
  )
}

interface CheckPillProps {
  checked: boolean
  onChange: (value: boolean) => void
  children: ReactNode
}

export function CheckPill({ checked, onChange, children }: CheckPillProps) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-all ${
        checked
          ? 'border-brand-600 bg-brand-600 text-white shadow-md shadow-brand-600/20'
          : 'border-ink-200 bg-white text-ink-700 hover:border-brand-300 hover:text-brand-700'
      }`}
    >
      <span
        className={`flex size-4 items-center justify-center rounded-full border ${
          checked ? 'border-white/60 bg-white/20' : 'border-ink-300'
        }`}
      >
        {checked && (
          <svg viewBox="0 0 12 12" className="size-2.5" fill="none" aria-hidden="true">
            <path d="M2 6.5 4.5 9 10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      {children}
    </button>
  )
}
