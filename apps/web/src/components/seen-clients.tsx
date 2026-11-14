import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ClockIcon, MoreHorizontalIcon, PlugIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import {
  ErrorAlert,
  InlineCode,
  LoadingState,
  SimpleSelect,
  Snippet,
  StatusDot,
  UrlField,
} from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item'
import { del, enc, errorMessage, put } from '@/lib/api'
import { relativeTime, useTick } from '@/lib/format'
import { keys, useConfig, useSeenClients, useStatus } from '@/lib/queries'
import { configSnippet, sharedUrl } from '@/lib/snippets'
import type { SeenClient } from '@/lib/types'

/** Select value meaning "no exact rule: use client rules / the default". */
const RULES = '__rules__'

export const WAITING_EXPLAINER =
  'Connected to the shared /mcp URL without a matching rule. Pick a profile and it gets its tools right away — no reconnect needed.'

const VIA_TEXT: Record<SeenClient['lastVia'], string> = {
  path: 'Profile URL',
  header: 'Profile header',
  'client-rule': 'Client rule',
  default: 'Default profile',
  unassigned: 'Waiting',
}

/** Waiting clients first, then the most recently seen. */
export function sortSeen(clients: SeenClient[]): SeenClient[] {
  return [...clients].sort(
    (a, b) =>
      Number(b.waiting > 0) - Number(a.waiting > 0) || Date.parse(b.lastSeen) - Date.parse(a.lastSeen),
  )
}

function useAssignProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ name, profile }: { name: string; profile: string | null }) =>
      put<SeenClient>(`/seen-clients/${enc(name)}/profile`, { profile }),
    onSuccess: (updated, { name, profile }) => {
      qc.setQueryData<SeenClient[] | null>(keys.seenClients, (old) =>
        old?.map((c) => (c.name === name ? { ...c, ...updated } : c)),
      )
      void qc.invalidateQueries({ queryKey: keys.seenClients })
      void qc.invalidateQueries({ queryKey: keys.config })
      void qc.invalidateQueries({ queryKey: keys.sessions })
      toast.success(
        profile ? `${name} now uses ${profile}` : `${name} now follows client rules and the default profile`,
      )
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
}

/** Pick the profile for one seen client; writes an exact client rule for its name. */
export function ClientProfileSelect({
  client,
  profiles,
  size = 'sm',
  className,
}: {
  client: SeenClient
  profiles: string[]
  size?: 'sm' | 'default'
  className?: string
}) {
  const assign = useAssignProfile()
  const pending = assign.isPending ? assign.variables : undefined
  const value = pending ? (pending.profile ?? RULES) : (client.ruleProfile ?? RULES)
  return (
    <SimpleSelect
      size={size}
      className={className ?? 'w-56'}
      aria-label={`Profile for ${client.name}`}
      disabled={assign.isPending}
      value={value}
      onValueChange={(v) => assign.mutate({ name: client.name, profile: v === RULES ? null : v })}
      options={[
        {
          value: RULES,
          label:
            client.waiting > 0 && !client.matchedProfile ? 'Choose a profile…' : 'Use client rules / default',
        },
        ...profiles.map((p) => ({ value: p, label: p })),
      ]}
    />
  )
}

export function SeenStatus({ client }: { client: SeenClient }) {
  if (client.waiting > 0)
    return (
      <Badge variant="outline">
        <StatusDot tone="warning" pulse />
        Waiting for a profile
      </Badge>
    )
  if (client.sessions > 0)
    return (
      <Badge variant="outline">
        <StatusDot tone="success" />
        Live · {client.sessions} session{client.sessions === 1 ? '' : 's'}
      </Badge>
    )
  return (
    <Badge variant="outline">
      <StatusDot tone="neutral" />
      Offline
    </Badge>
  )
}

/** How the client's profile was (or would be) chosen, in words. */
function howChosen(c: SeenClient): string {
  if (c.waiting > 0) return 'Waiting: no rule or default matches'
  const via = VIA_TEXT[c.lastVia] ?? c.lastVia
  return c.lastProfile ? `${via} → ${c.lastProfile}` : via
}

function ForgetMenu({ client }: { client: SeenClient }) {
  const qc = useQueryClient()
  const forget = useMutation({
    mutationFn: () => del(`/seen-clients/${enc(client.name)}`),
    onSuccess: () => {
      qc.setQueryData<SeenClient[] | null>(keys.seenClients, (old) =>
        old?.filter((c) => c.name !== client.name),
      )
      toast.success(`Forgot ${client.name}`)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label={`More actions for ${client.name}`} />}
      >
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem variant="destructive" onClick={() => forget.mutate()}>
            <Trash2Icon />
            Forget this client
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SeenRow({ client, profiles }: { client: SeenClient; profiles: string[] }) {
  const title = (
    <>
      {client.name}
      {client.version && <span className="font-normal text-muted-foreground">{client.version}</span>}
    </>
  )
  const actions = (
    <ItemActions className="shrink-0">
      <ClientProfileSelect client={client} profiles={profiles} />
      <ForgetMenu client={client} />
    </ItemActions>
  )
  if (client.waiting > 0)
    return (
      <Alert>
        <ClockIcon />
        <AlertTitle className="flex flex-wrap items-center gap-2">
          {title}
          <SeenStatus client={client} />
        </AlertTitle>
        <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span>
            {WAITING_EXPLAINER} Last seen {relativeTime(client.lastSeen)}.
          </span>
          {actions}
        </AlertDescription>
      </Alert>
    )
  return (
    <Item variant="outline" className="flex-col items-start sm:flex-row sm:items-center">
      <ItemContent>
        <ItemTitle className="flex flex-wrap items-center gap-2">
          {title}
          <SeenStatus client={client} />
        </ItemTitle>
        <ItemDescription>
          {howChosen(client)} · last seen {relativeTime(client.lastSeen)}
          {client.ruleProfile ? ` · pinned to ${client.ruleProfile}` : ''}
        </ItemDescription>
      </ItemContent>
      {actions}
    </Item>
  )
}

/** "Any MCP client works": the shared URL to paste into clients without a preset. */
export function AnyClientWorks() {
  const status = useStatus()
  const port = status.data?.port
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-dashed p-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">Any MCP client works</h3>
        <p className="text-sm text-muted-foreground">
          Not in the list below? Paste the shared URL into the client's MCP settings (Streamable HTTP). Once
          it connects it appears here, and you can pick its profile without touching the client again.
        </p>
      </div>
      <UrlField url={sharedUrl(port)} label="Shared endpoint URL" />
      <Snippet title="Generic mcp.json entry" code={configSnippet('cursor', port, null)} />
    </div>
  )
}

/** The "Connected clients" section on the Clients page. */
export function SeenClientsCard() {
  useTick()
  const seen = useSeenClients()
  const config = useConfig()
  const profiles = Object.keys(config.data?.profiles ?? {})
  if (seen.data === null) return null // the daemon does not support it yet
  const list = sortSeen(seen.data ?? [])
  const waiting = list.filter((c) => c.waiting > 0).length

  return (
    <Card id="connected" className="scroll-mt-20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Connected clients
          {waiting > 0 && <Badge>{waiting} waiting</Badge>}
        </CardTitle>
        <CardDescription>
          Every MCP client that has connected, by the name it reports. Picking a profile here saves an exact
          client rule for that name (first in the list, so it wins) and applies to open sessions immediately.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {seen.isPending ? (
          <LoadingState rows={2} />
        ) : seen.error ? (
          <ErrorAlert error={seen.error} title="Could not load connected clients" />
        ) : !list.length ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <PlugIcon />
              </EmptyMedia>
              <EmptyTitle>No clients have connected yet</EmptyTitle>
              <EmptyDescription>
                Connect one below, or paste the shared URL into any MCP client. It shows up here as soon as it
                connects.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ItemGroup className="gap-2">
            {list.map((c) => (
              <SeenRow key={c.name} client={c} profiles={profiles} />
            ))}
          </ItemGroup>
        )}
        {!profiles.length && list.some((c) => c.waiting > 0) && (
          <p className="text-sm text-muted-foreground">
            Create a profile first; waiting clients can then be assigned to it.
          </p>
        )}
        <AnyClientWorks />
      </CardContent>
    </Card>
  )
}

/** Overview banners: one per client waiting for a profile. */
export function WaitingBanners() {
  const seen = useSeenClients()
  const config = useConfig()
  const profiles = Object.keys(config.data?.profiles ?? {})
  const waiting = sortSeen(seen.data ?? []).filter((c) => c.waiting > 0)
  if (!waiting.length) return null
  return (
    <section className="flex flex-col gap-2" aria-label="Clients waiting for a profile">
      {waiting.map((c) => (
        <Alert key={c.name}>
          <ClockIcon />
          <AlertTitle>
            {c.name} is waiting for a profile
            {c.waiting > 1 ? ` (${c.waiting} sessions)` : ''}
          </AlertTitle>
          <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>
              It connected to <InlineCode>/mcp</InlineCode> without a matching rule. Pick a profile and it
              gets its tools right away — no reconnect needed.
            </span>
            <ClientProfileSelect client={c} profiles={profiles} />
          </AlertDescription>
        </Alert>
      ))}
    </section>
  )
}

/** Number of clients currently waiting, for the sidebar badge. */
export function useWaitingCount(): number {
  const seen = useSeenClients()
  return (seen.data ?? []).filter((c) => c.waiting > 0).length
}
