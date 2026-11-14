import { useMutation } from '@tanstack/react-query'
import { KeyRoundIcon, LogInIcon } from 'lucide-react'
import { toast } from 'sonner'
import { StatusDot, type Tone } from '@/components/common'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { enc, errorMessage, post } from '@/lib/api'
import { secondsUntil, useTick } from '@/lib/format'
import type { ConnectionStatus } from '@/lib/types'

const LABEL: Record<string, { text: string; tone: Tone; pulse?: boolean }> = {
  ready: { text: 'Running', tone: 'success' },
  stopped: { text: 'Idle · starts on demand', tone: 'neutral' },
  starting: { text: 'Starting…', tone: 'warning', pulse: true },
  error: { text: 'Error', tone: 'destructive' },
  'needs-auth': { text: 'Sign-in required', tone: 'warning' },
}

/** The server's state in words, with a dot. */
export function ServerState({ status, enabled }: { status?: ConnectionStatus; enabled: boolean }) {
  useTick(1000)
  if (!enabled) return <Badge variant="outline">Disabled</Badge>
  const state = status?.state ?? 'stopped'
  const l = LABEL[state] ?? { text: state, tone: 'neutral' as Tone }
  const wait = state === 'error' ? secondsUntil(status?.nextRestartAt) : undefined
  return (
    <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap">
      <StatusDot tone={l.tone} pulse={l.pulse} />
      <span className="font-medium">{l.text}</span>
      {wait !== undefined && <span className="text-muted-foreground">· restarting in {wait}s</span>}
      {(status?.restarts ?? 0) > 0 && state !== 'needs-auth' && (
        <span className="text-muted-foreground">
          · {status?.restarts} restart{status?.restarts === 1 ? '' : 's'}
        </span>
      )}
    </span>
  )
}

/** The one thing to do for a server that waits for OAuth sign-in. */
export function SignInCard({ name, authUrl }: { name: string; authUrl?: string }) {
  let provider: string | undefined
  try {
    provider = authUrl ? new URL(authUrl).host : undefined
  } catch {}
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <KeyRoundIcon className="size-5" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="font-medium">Sign in to {name}</p>
          <p className="text-sm text-muted-foreground">
            {name} uses OAuth. Sign in once{provider ? ` at ${provider}` : ' in your browser'}; Switchboard
            keeps the token and refreshes it. This page updates on its own when you are done.
          </p>
        </div>
        <SignInButton name={name} size="default" />
      </CardContent>
    </Card>
  )
}

/** Start an OAuth sign-in for a server and open the provider's page. */
export function SignInButton({ name, size = 'sm' }: { name: string; size?: 'sm' | 'default' }) {
  const auth = useMutation({
    mutationFn: () =>
      post<{ ok: boolean; authUrl?: string; signedIn?: boolean; error?: string }>(
        `/servers/${enc(name)}/auth`,
      ),
    onSuccess: (r) => {
      if (r.authUrl) {
        window.open(r.authUrl, '_blank', 'noopener')
        toast.info(`Finish signing in to ${name} in the new tab`)
      } else if (r.signedIn) toast.success(`${name} is signed in`)
      else toast.error(r.error ?? 'The server did not ask for sign-in')
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Button size={size} disabled={auth.isPending} onClick={() => auth.mutate()}>
      {auth.isPending ? <Spinner data-icon="inline-start" /> : <LogInIcon data-icon="inline-start" />}
      Sign in
    </Button>
  )
}
