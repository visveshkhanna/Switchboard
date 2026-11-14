import { brand } from '@switchboard/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckIcon, PlugZapIcon, XIcon } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import {
  ErrorAlert,
  InlineCode,
  LoadingState,
  Page,
  SimpleSelect,
  Snippet,
  UrlField,
} from '@/components/common'
import { SetupWithAI } from '@/components/SetupWithAI'
import { WaitingBanners } from '@/components/seen-clients'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { put } from '@/lib/api'
import { relativeTime, useTick } from '@/lib/format'
import { keys, useClients, useConfig, useServers, useSessions, useSettings, useStatus } from '@/lib/queries'
import { Link } from '@/lib/router'
import { configSnippet, profileUrl, sharedUrl } from '@/lib/snippets'
import type { Settings } from '@/lib/types'
import { cn } from '@/lib/utils'

const VIA: Record<string, string> = {
  path: 'URL path',
  header: 'header',
  'client-rule': 'client rule',
  default: 'default profile',
  unassigned: 'waiting for a profile',
}

export function viaLabel(via: string): string {
  return VIA[via] ?? via
}

function Stat({ label, value, sub, to }: { label: string; value: ReactNode; sub?: ReactNode; to: string }) {
  return (
    <Link to={to} className="group rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
      <Card size="sm" className="h-full transition-colors group-hover:bg-muted/40">
        <CardHeader>
          <CardDescription>{label}</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums group-data-[size=sm]/card:text-2xl">
            {value}
          </CardTitle>
        </CardHeader>
        {sub && <CardContent className="text-xs text-muted-foreground">{sub}</CardContent>}
      </Card>
    </Link>
  )
}

export function OverviewPage() {
  useTick()
  const status = useStatus()
  const servers = useServers()
  const sessions = useSessions()

  const s = status.data
  const ready = servers.data?.filter((r) => r.status?.state === 'ready').length ?? 0
  const errored = servers.data?.filter((r) => r.status?.state === 'error').length ?? 0
  const needsAuth = servers.data?.filter((r) => r.status?.state === 'needs-auth').length ?? 0

  return (
    <Page
      title="Overview"
      description={
        s ? (
          <>
            Daemon v{s.version} on port {s.port ?? '—'} · pid {s.pid} · started {relativeTime(s.startedAt)}
          </>
        ) : undefined
      }
      actions={<SetupWithAI variant="default" />}
    >
      {status.isPending ? (
        <LoadingState />
      ) : status.error ? (
        <ErrorAlert error={status.error} title="Could not reach the daemon" />
      ) : (
        <>
          <WaitingBanners />

          <GetStarted />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Stat
              label="Servers"
              value={status.data.servers}
              to="/servers"
              sub={
                status.data.servers ? (
                  <>
                    {ready} running
                    {errored ? <span className="text-destructive"> · {errored} failing</span> : null}
                    {needsAuth ? <> · {needsAuth} need sign-in</> : null}
                  </>
                ) : (
                  'None yet'
                )
              }
            />
            <Stat
              label="Profiles"
              value={status.data.profiles}
              to="/profiles"
              sub={status.data.profiles ? 'Each at /p/<name>/mcp' : 'None yet'}
            />
            <Stat
              label="Active sessions"
              value={status.data.sessions}
              to="/activity"
              sub="Connected MCP clients"
            />
          </div>

          <ConnectAnything port={status.data.port} />

          <Card>
            <CardHeader>
              <CardTitle>Active sessions</CardTitle>
              <CardDescription>
                Clients connected right now, and how their profile was chosen.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {sessions.isPending ? (
                <LoadingState rows={1} />
              ) : !sessions.data?.length ? (
                <Empty className="border">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <PlugZapIcon />
                    </EmptyMedia>
                    <EmptyTitle>No clients connected</EmptyTitle>
                    <EmptyDescription>
                      Sessions appear here as soon as an AI client opens a profile endpoint.
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button variant="outline" render={<Link to="/clients" />} nativeButton={false}>
                      Connect a client
                    </Button>
                  </EmptyContent>
                </Empty>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Client</TableHead>
                      <TableHead>Profile</TableHead>
                      <TableHead>Resolved by</TableHead>
                      <TableHead>Surface</TableHead>
                      <TableHead>Connected</TableHead>
                      <TableHead>Last seen</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sessions.data.map((x) => (
                      <TableRow key={x.id}>
                        <TableCell>
                          <span className="font-medium">{x.client?.name ?? 'unknown'}</span>
                          {x.client?.version && (
                            <span className="ml-1 text-xs text-muted-foreground">{x.client.version}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {x.profile ? (
                            <Link to={`/profiles/${x.profile}`} className="text-primary hover:underline">
                              {x.profile}
                            </Link>
                          ) : (
                            <Link to="/clients#connected" className="text-muted-foreground hover:underline">
                              waiting
                            </Link>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{viaLabel(x.via)}</Badge>
                        </TableCell>
                        <TableCell>
                          {x.surface ? (
                            <InlineCode>{x.surface}</InlineCode>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{relativeTime(x.createdAt)}</TableCell>
                        <TableCell className="text-muted-foreground">{relativeTime(x.lastSeenAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Daemon</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[180px_minmax(0,1fr)]">
                {[
                  ['State directory', status.data.home],
                  ['Config file', status.data.configPath],
                  ['Secrets backend', status.data.secretsBackend],
                ].map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="truncate font-mono text-xs leading-5">{v}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        </>
      )}
    </Page>
  )
}

const DISMISS_KEY = `${brand.name}.onboarding.dismissed`

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

interface Step {
  id: string
  title: string
  done: boolean
  body: ReactNode
  action?: ReactNode
}

/** The "Get started" checklist, shown until setup is complete and dismissed. */
function GetStarted() {
  const status = useStatus()
  const clients = useClients()
  const sessions = useSessions()
  const settings = useSettings()
  const qc = useQueryClient()
  const [dismissed, setDismissed] = useState(readDismissed)
  const setLog = useMutation({
    mutationFn: (activityLog: boolean) => put<Settings>('/settings', { activityLog }),
    onSuccess: (data) => {
      qc.setQueryData(keys.settings, data)
      void qc.invalidateQueries({ queryKey: keys.config })
    },
  })

  if (!status.data || clients.isPending || settings.isPending) return null
  const connected =
    (clients.data ?? []).some((c) => c.connectedProfile || c.connectedMode === 'auto') ||
    (sessions.data?.length ?? 0) > 0

  const steps: Step[] = [
    {
      id: 'servers',
      title: 'Add or import MCP servers',
      done: status.data.servers > 0,
      body: 'Bring in the servers your AI clients already use, or add one by command or URL.',
      action: (
        <>
          <Button size="sm" render={<Link to="/import" />} nativeButton={false}>
            Import
          </Button>
          <Button size="sm" variant="outline" render={<Link to="/servers/new" />} nativeButton={false}>
            Add server
          </Button>
        </>
      ),
    },
    {
      id: 'profile',
      title: 'Create a profile',
      done: status.data.profiles > 0,
      body: 'A profile groups servers and tools, such as "personal" and "work", each at its own URL.',
      action: (
        <Button size="sm" render={<Link to="/profiles/new" />} nativeButton={false}>
          New profile
        </Button>
      ),
    },
    {
      id: 'client',
      title: 'Connect a client',
      done: connected,
      body: 'Let Switchboard write its entry into Cursor, Claude Code, VS Code and others, or copy a URL.',
      action: (
        <>
          <Button size="sm" render={<Link to="/clients" />} nativeButton={false}>
            Clients
          </Button>
          <Button size="sm" variant="outline" render={<a href="#connect" />} nativeButton={false}>
            Copy a URL
          </Button>
        </>
      ),
    },
  ]
  if (settings.data) {
    const log = settings.data.activityLog
    steps.push({
      id: 'activity',
      title: 'Choose whether to keep an activity log',
      done: log !== null,
      body:
        log === null
          ? 'Records tool names, timing and success (never arguments or results) to power the Activity charts.'
          : `The activity log is ${log ? 'on' : 'off'}. Change it any time on the Activity page.`,
      action:
        log === null ? (
          <>
            <Button size="sm" disabled={setLog.isPending} onClick={() => setLog.mutate(true)}>
              {setLog.isPending && setLog.variables === true && <Spinner data-icon="inline-start" />}
              Yes, keep a log
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={setLog.isPending}
              onClick={() => setLog.mutate(false)}
            >
              {setLog.isPending && setLog.variables === false && <Spinner data-icon="inline-start" />}
              No
            </Button>
          </>
        ) : undefined,
    })
  }

  const done = steps.filter((x) => x.done).length
  const complete = done === steps.length
  if (complete && dismissed) return null

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      // Without storage it stays hidden for this visit only.
    }
    setDismissed(true)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{complete ? 'You are all set' : 'Get started'}</CardTitle>
        <CardDescription>
          {done} of {steps.length} done
          {complete ? ' · every client you connect now shares the same servers.' : ''}
        </CardDescription>
        <CardAction>
          {complete ? (
            <Button variant="outline" size="sm" onClick={dismiss}>
              <XIcon data-icon="inline-start" />
              Dismiss
            </Button>
          ) : (
            <SetupWithAI size="sm" />
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Progress value={(done / steps.length) * 100} aria-label="Setup progress" />
        <ItemGroup className="gap-1">
          {steps.map((step, i) => (
            <Item key={step.id} size="sm" className="flex-col items-start sm:flex-row sm:items-center">
              <ItemMedia>
                <span
                  className={cn(
                    'flex size-6 items-center justify-center rounded-full border text-xs font-semibold',
                    step.done ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground',
                  )}
                  aria-hidden="true"
                >
                  {step.done ? <CheckIcon className="size-3.5" /> : i + 1}
                </span>
              </ItemMedia>
              <ItemContent>
                <ItemTitle className={cn(step.done && 'text-muted-foreground line-through')}>
                  {step.title}
                  <span className="sr-only">{step.done ? ' (done)' : ' (to do)'}</span>
                </ItemTitle>
                <ItemDescription>{step.body}</ItemDescription>
                {setLog.error && step.id === 'activity' ? (
                  <ItemDescription className="text-destructive">Could not save. Try again.</ItemDescription>
                ) : null}
              </ItemContent>
              {!step.done && step.action && <ItemActions className="flex-wrap">{step.action}</ItemActions>}
            </Item>
          ))}
        </ItemGroup>
      </CardContent>
    </Card>
  )
}

/** Copy-paste URLs and config for any MCP client. */
function ConnectAnything({ port }: { port?: number }) {
  const config = useConfig()
  const profiles = Object.keys(config.data?.profiles ?? {})
  const [picked, setPicked] = useState('')
  const profile = profiles.includes(picked) ? picked : (config.data?.defaultProfile ?? profiles[0] ?? '')
  const defaultProfile = config.data?.defaultProfile

  return (
    <Card id="connect" className="scroll-mt-20">
      <CardHeader>
        <CardTitle>Connect anything</CardTitle>
        <CardDescription>
          Any MCP client that speaks Streamable HTTP can use these. Restart the client after editing its
          config.
        </CardDescription>
        {profiles.length > 1 && (
          <CardAction>
            <SimpleSelect
              size="sm"
              aria-label="Profile"
              className="w-40"
              value={profile}
              onValueChange={setPicked}
              options={profiles.map((p) => ({ value: p, label: p }))}
            />
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            Profile URL {profile && <Badge variant="secondary">{profile}</Badge>}
          </h3>
          {config.isPending ? (
            <LoadingState rows={1} />
          ) : profile ? (
            <>
              <UrlField url={profileUrl(port, profile)} label={`${profile} URL`} />
              <p className="text-xs text-muted-foreground">
                Always serves this profile, whatever the client is.
              </p>
              <Snippet
                title="mcp.json · Cursor and most clients"
                code={configSnippet('cursor', port, profile)}
              />
            </>
          ) : (
            <Empty className="border">
              <EmptyHeader>
                <EmptyTitle>No profiles yet</EmptyTitle>
                <EmptyDescription>Create a profile to get its own URL.</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button size="sm" render={<Link to="/profiles/new" />} nativeButton={false}>
                  New profile
                </Button>
              </EmptyContent>
            </Empty>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <h3 className="text-sm font-medium">Shared endpoint</h3>
          <UrlField url={sharedUrl(port)} label="Shared endpoint URL" />
          <p className="text-xs text-muted-foreground">
            One URL for every client. Switchboard picks the profile from{' '}
            <Link to="/clients#rules" className="text-primary hover:underline">
              client rules
            </Link>{' '}
            (matched on the client's name), then the{' '}
            <Link to="/clients#default" className="text-primary hover:underline">
              default profile
            </Link>
            {defaultProfile ? (
              <>
                {' '}
                (now <InlineCode>{defaultProfile}</InlineCode>).
              </>
            ) : (
              ' (none set, so unmatched clients wait until you assign them a profile).'
            )}
          </p>
          <Snippet title="mcp.json · shared endpoint" code={configSnippet('cursor', port, null)} />
        </div>
      </CardContent>
      <CardContent>
        <p className="text-xs text-muted-foreground">
          VS Code, Codex, Windsurf, Gemini CLI and Claude Desktop use other formats: see{' '}
          <Link to="/clients" className="text-primary hover:underline">
            Clients
          </Link>
          , or let <span className="font-medium text-foreground">Set up with AI</span> write the prompt for
          you.
        </p>
      </CardContent>
    </Card>
  )
}
