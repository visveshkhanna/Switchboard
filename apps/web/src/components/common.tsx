import { CheckIcon, CopyIcon } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockTitle,
} from '@/components/ui/code-block'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { ApiError, errorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'

/**
 * A page: a sticky title bar (sidebar trigger, back link, title, actions), an
 * optional description, the content, and an optional sticky footer.
 */
export function Page({
  title,
  description,
  actions,
  back,
  footer,
  children,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  back?: ReactNode
  footer?: ReactNode
  children: ReactNode
}) {
  return (
    <>
      <header className="sticky top-0 z-10 flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b bg-background/95 px-4 py-2 backdrop-blur supports-backdrop-filter:bg-background/80 md:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="h-4 data-vertical:self-center" />
        <div className="flex min-w-0 flex-1 flex-col">
          {back && <div className="text-xs text-muted-foreground">{back}</div>}
          <h1 className="truncate font-heading text-base font-semibold md:text-lg">{title}</h1>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-4 md:p-6">
        {description && <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>}
        {children}
      </div>
      {footer && (
        <div className="sticky bottom-0 z-10 border-t bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/80">
          <div className="mx-auto flex min-h-14 w-full max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5 md:px-6">
            {footer}
          </div>
        </div>
      )}
    </>
  )
}

export function CopyButton({
  text,
  label = 'Copy',
  variant = 'outline',
  size = 'sm',
}: {
  text: string
  label?: string
  variant?: 'outline' | 'ghost' | 'default' | 'secondary'
  size?: 'sm' | 'default' | 'xs'
}) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])
  return (
    <Button
      variant={variant}
      size={size}
      onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true))}
    >
      {copied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
      <span aria-live="polite">{copied ? 'Copied' : label}</span>
    </Button>
  )
}

/** A read-only URL with a copy button. */
export function UrlField({ url, label }: { url: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])
  return (
    <InputGroup>
      <InputGroupInput
        readOnly
        value={url}
        aria-label={label ?? 'URL'}
        className="font-mono text-xs"
        onFocus={(e) => e.currentTarget.select()}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          aria-label={copied ? 'Copied' : `Copy ${label ?? 'URL'}`}
          onClick={() => void navigator.clipboard.writeText(url).then(() => setCopied(true))}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? 'Copied' : 'Copy'}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}

/** A titled, copyable code snippet. */
export function Snippet({
  title,
  code,
  className,
  wrap,
}: {
  title: ReactNode
  code: string
  className?: string
  wrap?: boolean
}) {
  return (
    <CodeBlock size="sm" className={className}>
      <CodeBlockHeader>
        <CodeBlockTitle>{title}</CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={code} />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent wrap={wrap} className="max-h-80">
        {code}
      </CodeBlockContent>
    </CodeBlock>
  )
}

export function InlineCode({ children }: { children: ReactNode }) {
  return <code className="rounded bg-muted px-1 py-px font-mono text-[0.85em]">{children}</code>
}

/** An API error with its `problems` list. */
export function ErrorAlert({ error, title }: { error: unknown; title?: string }) {
  if (!error) return null
  const problems = error instanceof ApiError ? error.problems : []
  return (
    <Alert variant="destructive">
      <AlertTitle>{title ?? errorMessage(error)}</AlertTitle>
      {(title || problems.length > 0) && (
        <AlertDescription>
          {title && <p>{errorMessage(error)}</p>}
          {problems.length > 0 && (
            <ul className="list-disc pl-5 font-mono text-xs">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </AlertDescription>
      )}
    </Alert>
  )
}

/** Placeholder rows while a page loads. */
export function LoadingState({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="Loading">
      <Skeleton className="h-6 w-48" />
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  )
}

/** A button that asks before doing something destructive. */
export function ConfirmButton({
  children,
  title,
  description,
  confirmLabel = 'Delete',
  onConfirm,
  size = 'default',
  variant = 'destructive',
}: {
  children: ReactNode
  title: string
  description?: ReactNode
  confirmLabel?: string
  onConfirm: () => unknown
  size?: 'sm' | 'default'
  variant?: 'destructive' | 'outline'
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>()
  const run = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await onConfirm()
      setOpen(false)
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant={variant} size={size} />}>{children}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        {error ? <ErrorAlert error={error} /> : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={busy} onClick={() => void run()}>
            {busy && <Spinner data-icon="inline-start" />}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export interface Option {
  value: string
  label: ReactNode
}

/** A shadcn Select for a flat list of string options. */
export function SimpleSelect({
  id,
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  size = 'default',
  className,
  'aria-label': ariaLabel,
  'aria-invalid': ariaInvalid,
}: {
  id?: string
  value: string
  onValueChange: (value: string) => void
  options: Option[]
  placeholder?: string
  disabled?: boolean
  size?: 'sm' | 'default'
  className?: string
  'aria-label'?: string
  'aria-invalid'?: boolean
}) {
  return (
    <Select
      items={options}
      value={value}
      disabled={disabled}
      onValueChange={(v) => {
        if (typeof v === 'string') onValueChange(v)
      }}
    >
      <SelectTrigger
        id={id}
        size={size}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid}
        className={cn('w-full', className)}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

export type Tone = 'neutral' | 'success' | 'warning' | 'destructive' | 'primary'

const dotTone: Record<Tone, string> = {
  neutral: 'bg-muted-foreground/60',
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
  primary: 'bg-primary',
}

/** A small status dot; always pair it with a text label. */
export function StatusDot({ tone, pulse }: { tone: Tone; pulse?: boolean }) {
  return (
    <span className="relative inline-flex size-2 shrink-0" aria-hidden="true">
      {pulse && (
        <span className={cn('absolute inset-0 animate-ping rounded-full opacity-60', dotTone[tone])} />
      )}
      <span className={cn('relative inline-flex size-2 rounded-full', dotTone[tone])} />
    </span>
  )
}
