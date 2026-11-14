import {
  type ButtonHTMLAttributes,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { ApiError, errorMessage } from './api.ts'

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

// Form controls share these classes so native elements look consistent.
export const inputClass =
  'block w-full rounded-md border border-line-strong bg-panel px-2.5 py-1.5 text-sm text-fg placeholder:text-faint shadow-xs focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:opacity-60'
export const monoInputClass = `${inputClass} font-mono text-[13px]`

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:opacity-90 border border-transparent',
  secondary: 'bg-panel text-fg border border-line-strong hover:bg-subtle',
  ghost: 'text-muted hover:text-fg hover:bg-subtle border border-transparent',
  danger: 'bg-panel text-bad border border-line-strong hover:bg-bad/10 hover:border-bad/40',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-sm',
        variants[variant],
        className,
      )}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cx('size-3.5 animate-spin', className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export type Tone = 'neutral' | 'ok' | 'warn' | 'bad' | 'accent'
const tones: Record<Tone, string> = {
  neutral: 'bg-subtle text-muted border-line',
  ok: 'bg-ok/10 text-ok border-ok/25',
  warn: 'bg-warn/10 text-warn border-warn/25',
  bad: 'bg-bad/10 text-bad border-bad/25',
  accent: 'bg-accent/10 text-accent border-accent/25',
}

export function Badge({
  tone = 'neutral',
  children,
  title,
}: {
  tone?: Tone
  children: ReactNode
  title?: string
}) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center gap-1 rounded border px-1.5 py-px text-[11px] leading-4 font-medium whitespace-nowrap',
        tones[tone],
      )}
    >
      {children}
    </span>
  )
}

const dotTones: Record<Tone, string> = {
  neutral: 'bg-faint',
  ok: 'bg-ok',
  warn: 'bg-warn',
  bad: 'bg-bad',
  accent: 'bg-accent',
}
export function Dot({ tone, pulse, label }: { tone: Tone; pulse?: boolean; label?: string }) {
  const inner = (
    <>
      {pulse && (
        <span className={cx('absolute inset-0 animate-ping rounded-full opacity-60', dotTones[tone])} />
      )}
      <span className={cx('relative inline-flex size-2 rounded-full', dotTones[tone])} />
    </>
  )
  return label ? (
    <span className="relative inline-flex size-2 shrink-0" role="img" aria-label={label}>
      {inner}
    </span>
  ) : (
    <span className="relative inline-flex size-2 shrink-0" aria-hidden="true">
      {inner}
    </span>
  )
}

export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  back?: ReactNode
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {back && <div className="mb-1 text-xs text-muted">{back}</div>}
        <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

export function Card({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={cx('rounded-lg border border-line bg-panel shadow-xs', className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-fg">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={bodyClassName ?? 'p-4'}>{children}</div>
    </section>
  )
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  children: (id: string, describedBy: string | undefined) => ReactNode
  className?: string
}) {
  const id = useId()
  const hintId = `${id}-hint`
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-fg">
        {label}
      </label>
      {children(id, hint || error ? hintId : undefined)}
      {(error || hint) && (
        <p id={hintId} className={cx('mt-1 text-xs', error ? 'text-bad' : 'text-muted')}>
          {error ?? hint}
        </p>
      )}
    </div>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  size = 'md',
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
  size?: 'sm' | 'md'
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex shrink-0 items-center rounded-full border border-transparent transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-4 w-7' : 'h-5 w-9',
        checked ? 'bg-accent' : 'bg-line-strong',
      )}
    >
      <span
        className={cx(
          'inline-block rounded-full bg-white shadow transition-transform',
          size === 'sm' ? 'size-3' : 'size-4',
          checked ? (size === 'sm' ? 'translate-x-3.5' : 'translate-x-4.5') : 'translate-x-0.5',
        )}
      />
    </button>
  )
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: ReactNode
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-line-strong px-6 py-10 text-center">
      <p className="text-sm font-medium text-fg">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  )
}

/** An API error with its `problems` list, shown inline next to the form that caused it. */
export function ErrorBox({ error, title }: { error: unknown; title?: string }) {
  if (!error) return null
  const problems = error instanceof ApiError ? error.problems : []
  return (
    <div role="alert" className="rounded-md border border-bad/30 bg-bad/5 px-3 py-2 text-sm text-bad">
      <p className="font-medium">{title ?? errorMessage(error)}</p>
      {title && <p className="mt-0.5 text-xs">{errorMessage(error)}</p>}
      {problems.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-5 font-mono text-xs">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-muted" role="status">
      <Spinner /> {label}…
    </div>
  )
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label={`${label} to clipboard`}
      onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true))}
    >
      {copied ? 'Copied' : label}
    </Button>
  )
}

export function CodeBlock({ code, label }: { code: string; label?: string }) {
  return (
    <div className="overflow-hidden rounded-md border border-line bg-subtle">
      <div className="flex items-center justify-between border-b border-line px-3 py-1">
        <span className="text-[11px] font-medium text-muted">{label}</span>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto px-3 py-2 font-mono text-xs leading-5 text-fg">{code}</pre>
    </div>
  )
}

export function InlineCode({ children }: { children: ReactNode }) {
  return <code className="rounded bg-subtle px-1 py-px font-mono text-[12px] text-fg">{children}</code>
}

/** A button that asks before doing something destructive, using a native modal dialog. */
export function ConfirmButton({
  children,
  title,
  body,
  confirmLabel = 'Delete',
  onConfirm,
  size,
  variant = 'danger',
  disabled,
}: {
  children: ReactNode
  title: string
  body?: ReactNode
  confirmLabel?: string
  onConfirm: () => unknown
  size?: 'sm' | 'md'
  variant?: Variant
  disabled?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>()
  const titleId = useId()
  const run = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await onConfirm()
      ref.current?.close()
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Button size={size} variant={variant} disabled={disabled} onClick={() => ref.current?.showModal()}>
        {children}
      </Button>
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-line bg-panel p-0 text-fg shadow-xl"
      >
        <div className="p-5">
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          {body && <div className="mt-2 text-sm text-muted">{body}</div>}
          {error ? (
            <div className="mt-3">
              <ErrorBox error={error} />
            </div>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-line bg-subtle px-5 py-3">
          <Button onClick={() => ref.current?.close()}>Cancel</Button>
          <Button
            variant={variant === 'danger' ? 'danger' : 'primary'}
            loading={busy}
            onClick={() => void run()}
          >
            {confirmLabel}
          </Button>
        </div>
      </dialog>
    </>
  )
}

// Toasts
interface Toast {
  id: number
  text: string
  tone: Tone
}
const ToastContext = createContext<(text: string, tone?: Tone) => void>(() => {})
export const useToast = () => useContext(ToastContext)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((text: string, tone: Tone = 'neutral') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t.slice(-3), { id, text, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500)
  }, [])
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="flex items-center gap-2 rounded-md border border-line bg-panel px-3 py-2 text-sm text-fg shadow-lg"
          >
            <Dot tone={t.tone === 'neutral' ? 'accent' : t.tone} />
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function relativeTime(iso?: string): string {
  if (!iso) return '—'
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function duration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`
}

/** Re-render periodically so relative times stay fresh. */
export function useTick(ms = 15_000): void {
  const [, set] = useState(0)
  useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), ms)
    return () => clearInterval(t)
  }, [ms])
}

export const thClass = 'px-3 py-2 text-left text-[11px] font-medium tracking-wide text-muted uppercase'
export const tdClass = 'px-3 py-2 align-top'
