import { brand } from '@switchboard/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  CopyIcon,
  ExternalLinkIcon,
  MoreHorizontalIcon,
  PowerOffIcon,
  RotateCcwIcon,
  Trash2Icon,
  TriangleAlertIcon,
  WrenchIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { isWaiting, ProfileSwitches, useSetClientProfile } from '@/components/client-profiles'
import { RulesCard } from '@/components/client-rules'
import {
  ErrorAlert,
  InlineCode,
  LoadingState,
  Page,
  SimpleSelect,
  Snippet,
  StatusDot,
} from '@/components/common'
import { ConnectAnyClientCard } from '@/components/connect-any'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'
import { del, enc, errorMessage, post, put } from '@/lib/api'
import { relativeTime, useTick } from '@/lib/format'
import { keys, useClients, useConfig } from '@/lib/queries'
import { Link } from '@/lib/router'
import { clientInfo, clientSnippet } from '@/lib/snippets'
import type { ClientRow } from '@/lib/types'
import { cn } from '@/lib/utils'

/** Presets that are not installed and never connected: tucked away so the list stays focused. */
function isDormant(c: ClientRow): boolean {
  return Boolean(c.preset && !c.preset.installed && !c.lastSeen && c.preset.setup === 'none')
}

export function ClientsPage() {
  useTick()
  const clients = useClients()
  const config = useConfig()
  const profiles = Object.keys(config.data?.profiles ?? {})
  const rows = clients.data ?? []
  const main = rows.filter((c) => !isDormant(c)).sort((a, b) => Number(isWaiting(b)) - Number(isWaiting(a)))
  const dormant = rows.filter(isDormant)

  return (
    <Page
      title="Clients"
      description="Each client uses one profile. Flip a switch to change it — connected clients switch instantly, no restart."
      actions={
        config.data && <DefaultProfileControl current={config.data.defaultProfile} profiles={profiles} />
      }
    >
      {config.data && !profiles.length && (
        <Alert>
          <TriangleAlertIcon />
          <AlertTitle>No profiles yet</AlertTitle>
          <AlertDescription>
            Clients can connect, but they get no tools until a profile exists.{' '}
            <Link to="/profiles/new">Create a profile</Link>.
          </AlertDescription>
        </Alert>
      )}

      {clients.isPending ? (
        <LoadingState rows={4} />
      ) : clients.error ? (
        <ErrorAlert error={clients.error} title="Could not load clients" />
      ) : (
        <div className="flex flex-col gap-3">
          {main.map((c) => (
            <ClientCard key={c.id} client={c} profiles={profiles} />
          ))}
          {!main.length && (
            <p className="text-sm text-muted-foreground">
              No clients yet. Set one up from the list below, or connect any client.
            </p>
          )}
        </div>
      )}

      {dormant.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger render={<Button variant="ghost" className="group/other -ml-2 w-fit" />}>
            Other supported clients ({dormant.length})
            <ChevronDownIcon
              data-icon="inline-end"
              className="transition-transform group-data-[panel-open]/other:rotate-180"
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-3 pt-3">
            <p className="text-sm text-muted-foreground">
              Not found on this machine. Setting one up still writes its config file.
            </p>
            {dormant.map((c) => (
              <ClientCard key={c.id} client={c} profiles={profiles} />
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}

      <ConnectAnyClientCard />

      {config.data && (
        <Collapsible>
          <CollapsibleTrigger render={<Button variant="ghost" className="group/adv -ml-2 w-fit" />}>
            <WrenchIcon data-icon="inline-start" />
            Advanced
            <ChevronDownIcon
              data-icon="inline-end"
              className="transition-transform group-data-[panel-open]/adv:rotate-180"
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-4 pt-3">
            <RulesCard rules={config.data.clientRules} profiles={profiles} />
            <Alert>
              <AlertTitle>Pinned profile URLs</AlertTitle>
              <AlertDescription>
                <InlineCode>/p/&lt;profile&gt;/mcp</InlineCode> always serves that profile, whatever is
                switched on here. Use it only when a client must never change profile; switches on this page
                do not apply to it.
              </AlertDescription>
            </Alert>
          </CollapsibleContent>
        </Collapsible>
      )}
    </Page>
  )
}

const NONE = '__none__'

function DefaultProfileControl({ current, profiles }: { current?: string; profiles: string[] }) {
  const qc = useQueryClient()
  const save = useMutation({
    mutationFn: (profile: string | null) => put('/default-profile', { profile }),
    onSuccess: (_d, p) => {
      void qc.invalidateQueries({ queryKey: keys.config })
      void qc.invalidateQueries({ queryKey: keys.clients })
      toast.success(p ? `New clients use ${p}` : 'New clients wait until you pick a profile')
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <div className="flex items-center gap-2">
      <label
        htmlFor="default-profile"
        className="hidden text-sm whitespace-nowrap text-muted-foreground sm:block"
      >
        New clients use
      </label>
      <SimpleSelect
        id="default-profile"
        size="sm"
        className="w-40"
        aria-label="Default profile for new clients"
        value={current ?? NONE}
        disabled={save.isPending}
        onValueChange={(v) => save.mutate(v === NONE ? null : v)}
        options={[
          ...profiles.map((p) => ({ value: p, label: p })),
          { value: NONE, label: 'No profile (wait)' },
        ]}
      />
    </div>
  )
}

function ClientStatus({ client: c }: { client: ClientRow }) {
  if (c.sessions > 0)
    return (
      <Badge variant="outline">
        <StatusDot tone="success" />
        Live · {c.sessions} session{c.sessions === 1 ? '' : 's'}
      </Badge>
    )
  if (c.lastSeen)
    return (
      <Badge variant="outline">
        <StatusDot tone="neutral" />
        Offline · {relativeTime(c.lastSeen)}
      </Badge>
    )
  return <Badge variant="outline">Never connected</Badge>
}

function helperText(c: ClientRow): string {
  if (c.selection === 'off') return 'All profiles off: this client gets no tools.'
  if (c.via === 'client-rule')
    return `Set by a client rule (${c.effectiveProfile}). Turn a profile on to override it.`
  if (c.selection === 'default')
    return c.effectiveProfile
      ? `Following the default profile (${c.effectiveProfile}).`
      : 'Following the default profile, but none is set: turn a profile on.'
  return `Uses ${c.effectiveProfile}. Switches apply instantly.`
}

function useClientActions(c: ClientRow) {
  const qc = useQueryClient()
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.clients })
    void qc.invalidateQueries({ queryKey: keys.sessions })
  }
  const connect = useMutation({
    mutationFn: () =>
      post<{ ok: boolean; path?: string; backup?: string }>(`/clients/${enc(c.id)}/connect`, {}),
    onSuccess: (r) => {
      refresh()
      toast.success(`${c.name} is set up. Restart it once to pick it up.`, {
        description: r.path ? `Wrote ${r.path}${r.backup ? ' (backup kept)' : ''}` : undefined,
      })
    },
    onError: (e) => toast.error(`Could not set up ${c.name}: ${errorMessage(e)}`),
  })
  const disconnect = useMutation({
    mutationFn: () => post(`/clients/${enc(c.id)}/disconnect`),
    onSuccess: () => {
      refresh()
      toast.success(`Removed ${brand.displayName} from ${c.name}'s config`)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const forget = useMutation({
    mutationFn: () => del(`/clients/${enc(c.id)}`),
    onSuccess: () => {
      refresh()
      toast.success(`Forgot ${c.name}`)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return { connect, disconnect, forget }
}

type Actions = ReturnType<typeof useClientActions>

function ClientMenu({ client: c, actions }: { client: ClientRow; actions: Actions }) {
  const set = useSetClientProfile()
  const setup = c.preset?.setup
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label={`More actions for ${c.name}`} />}
      >
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuItem
            disabled={c.selection === 'default'}
            onClick={() => set.mutate({ id: c.id, choice: { useDefault: true } })}
          >
            <RotateCcwIcon />
            Use the default profile
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={c.selection === 'off'}
            onClick={() => set.mutate({ id: c.id, choice: { profile: null } })}
          >
            <PowerOffIcon />
            Turn all profiles off
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              void navigator.clipboard.writeText(c.url).then(() => toast.success(`Copied ${c.name}'s URL`))
            }
          >
            <CopyIcon />
            Copy this client's URL
          </DropdownMenuItem>
        </DropdownMenuGroup>
        {c.preset && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {setup !== 'managed' && setup !== 'foreign' && (
                <DropdownMenuItem onClick={() => actions.connect.mutate()}>
                  <WrenchIcon />
                  Set up (write its config file)
                </DropdownMenuItem>
              )}
              {setup && setup !== 'none' && setup !== 'foreign' && (
                <DropdownMenuItem onClick={() => actions.disconnect.mutate()}>
                  <PowerOffIcon />
                  Remove from its config file
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => window.open(c.preset?.docs, '_blank', 'noopener,noreferrer')}>
                <ExternalLinkIcon />
                {c.name} MCP docs
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            variant="destructive"
            disabled={c.sessions > 0}
            onClick={() => actions.forget.mutate()}
          >
            <Trash2Icon />
            {c.sessions > 0 ? 'Forget (while offline)' : 'Forget'}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SetupButton({ actions, label = 'Set up' }: { actions: Actions; label?: string }) {
  return (
    <Button size="sm" disabled={actions.connect.isPending} onClick={() => actions.connect.mutate()}>
      {actions.connect.isPending && <Spinner data-icon="inline-start" />}
      {label}
    </Button>
  )
}

function WhatWillBeWritten({ client: c }: { client: ClientRow }) {
  const info = clientInfo(c.id)
  return (
    <Collapsible>
      <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="group/what -ml-2 w-fit" />}>
        What will be written
        <ChevronDownIcon
          data-icon="inline-end"
          className="transition-transform group-data-[panel-open]/what:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-2 pt-2">
        <p className="text-xs text-muted-foreground">
          One entry named <InlineCode>{brand.name}</InlineCode>
          {info?.format === 'json' ? ` under "${info.key}"` : ''}, pointing at this client's own URL. A backup
          is kept and other entries are not touched.
        </p>
        <Snippet title={info?.file ?? c.preset?.configPath ?? 'config'} code={clientSnippet(c.id, c.url)} />
      </CollapsibleContent>
    </Collapsible>
  )
}

/** How a preset client's config file reaches Switchboard, and what to do about it. */
function SetupSection({ client: c, actions }: { client: ClientRow; actions: Actions }) {
  const p = c.preset
  if (!p) return null
  if (p.error)
    return (
      <Alert variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>Could not read its config file</AlertTitle>
        <AlertDescription>{p.error}</AlertDescription>
      </Alert>
    )
  switch (p.setup) {
    case 'managed':
      return null
    case 'none':
      return (
        <div className="flex flex-col gap-1 rounded-lg border border-dashed p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 text-sm text-muted-foreground">
              Adds one entry to <span className="font-mono text-xs break-all">{p.configPath}</span>. Restart{' '}
              {c.name} once.
            </p>
            <SetupButton actions={actions} />
          </div>
          <WhatWillBeWritten client={c} />
        </div>
      )
    case 'profile':
      return (
        <Alert>
          <TriangleAlertIcon />
          <AlertTitle>Pinned to {p.pinnedProfile} by its URL, so switches here don't apply</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            <span>
              Its config file points at <InlineCode>/p/{p.pinnedProfile}/mcp</InlineCode>.
            </span>
            <SetupButton actions={actions} label="Switch to Switchboard-managed" />
          </AlertDescription>
        </Alert>
      )
    case 'auto':
      return (
        <Alert>
          <AlertTitle>Uses the shared URL; identified by its MCP name</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            <span>Switches work. Its own URL is more reliable if several clients report the same name.</span>
            <SetupButton actions={actions} />
          </AlertDescription>
        </Alert>
      )
    case 'foreign':
      return (
        <Alert>
          <TriangleAlertIcon />
          <AlertTitle>Its config already has a "{brand.name}" entry Switchboard did not write</AlertTitle>
          <AlertDescription>
            Rename or remove that entry in <span className="font-mono break-all">{p.configPath}</span>, then
            set it up here.
          </AlertDescription>
        </Alert>
      )
  }
}

function ClientCard({ client: c, profiles }: { client: ClientRow; profiles: string[] }) {
  const actions = useClientActions(c)
  const waiting = isWaiting(c)
  const off = c.selection === 'off'
  const meta = [
    c.id,
    c.clientInfoName && c.clientInfoName !== c.id ? c.clientInfoName : null,
    c.version ? `v${c.version}` : null,
  ].filter(Boolean)

  return (
    <Card size="sm" className={cn(waiting && 'ring-2 ring-warning/60', off && 'bg-muted/40')}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {c.name}
          <ClientStatus client={c} />
          {c.preset?.setup === 'managed' && (
            <Badge variant="secondary">
              <CheckIcon data-icon="inline-start" />
              Set up
            </Badge>
          )}
          {off && <Badge variant="outline">No tools</Badge>}
        </CardTitle>
        <CardDescription className="font-mono text-xs">{meta.join(' · ')}</CardDescription>
        <CardAction>
          <ClientMenu client={c} actions={actions} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {waiting && (
          <p className="flex items-center gap-2 text-sm font-medium">
            <ClockIcon className="size-4 text-warning" aria-hidden="true" />
            Waiting for a profile — turn one on.
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          <ProfileSwitches client={c} profiles={profiles} />
          {!waiting && <p className="text-xs text-muted-foreground">{helperText(c)}</p>}
        </div>
        <SetupSection client={c} actions={actions} />
      </CardContent>
    </Card>
  )
}
