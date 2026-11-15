import { slugSchema } from '@switchboard/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ClipboardPasteIcon,
  DownloadIcon,
  FlaskConicalIcon,
  PlusIcon,
  RotateCwIcon,
  ServerIcon,
  TriangleAlertIcon,
  XIcon,
} from 'lucide-react'
import { type ReactNode, useEffect, useId, useState } from 'react'
import { toast } from 'sonner'
import {
  ConfirmButton,
  ErrorAlert,
  InlineCode,
  LoadingState,
  Page,
  SimpleSelect,
  Snippet,
  StatusDot,
} from '@/components/common'
import { ServerState, SignInButton, SignInCard } from '@/components/server-status'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { del, enc, errorMessage, post, put } from '@/lib/api'
import { relativeTime, secondsUntil, useTick } from '@/lib/format'
import { KVEditor } from '@/lib/kv'
import { keys, useLogs, useSecrets, useServers, useTools } from '@/lib/queries'
import { Link, navigate, useLocation } from '@/lib/router'
import {
  configFromForm,
  emptyForm,
  formFromConfig,
  parsePastedEntry,
  type ServerForm,
  secretRefs,
  summary,
} from '@/lib/serverForm'
import type { ConnectionStatus, ServerConfig, ServerRow, TestResult } from '@/lib/types'

const DEFAULT_IDLE = '600'

/** Still waiting for the first tool list from a server that should be starting. */
function isDiscovering(enabled: boolean, st?: ConnectionStatus): boolean {
  return enabled && st?.toolCount === undefined && st?.state !== 'error' && st?.state !== 'needs-auth'
}

function keepsRunning(row: ServerRow): boolean {
  return row.status?.keepRunning ?? row.config.idleTimeoutSec === 0
}

function useInvalidateServers() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: keys.servers })
    void qc.invalidateQueries({ queryKey: keys.config })
    void qc.invalidateQueries({ queryKey: keys.status })
  }
}

function useToggleEnabled() {
  const invalidate = useInvalidateServers()
  return useMutation({
    mutationFn: (row: ServerRow) =>
      put(`/servers/${enc(row.name)}`, { ...row.config, enabled: !row.config.enabled }),
    onSuccess: (_d, row) => {
      invalidate()
      toast.success(`${row.name} ${row.config.enabled ? 'disabled' : 'enabled'}`)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
}

const SERVERS_CRUMB = { label: 'Servers', to: '/servers' }

export function ServersPage() {
  const servers = useServers()
  const toggle = useToggleEnabled()

  return (
    <Page
      title="Servers"
      description="The MCP servers Switchboard runs. Each one starts once and is shared by every client. Idle servers stop and start again on the next call, unless they are set to keep running."
      actions={
        <>
          <Button variant="outline" onClick={() => navigate('/import')}>
            <DownloadIcon data-icon="inline-start" />
            Import
          </Button>
          <Button onClick={() => navigate('/servers/new')}>
            <PlusIcon data-icon="inline-start" />
            Add server
          </Button>
        </>
      }
    >
      {servers.isPending ? (
        <LoadingState />
      ) : servers.error ? (
        <ErrorAlert error={servers.error} />
      ) : !servers.data.length ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ServerIcon />
            </EmptyMedia>
            <EmptyTitle>No servers yet</EmptyTitle>
            <EmptyDescription>
              Import the servers you already use in Cursor, Claude Code or VS Code, or add one by command or
              URL.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row justify-center">
            <Button onClick={() => navigate('/import')}>Import from your clients</Button>
            <Button variant="outline" onClick={() => navigate('/servers/new')}>
              Add manually
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Command / URL</TableHead>
                <TableHead className="text-right">Tools</TableHead>
                <TableHead className="hidden text-right sm:table-cell">PID</TableHead>
                <TableHead className="text-right">Enabled</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {servers.data.map((row) => {
                const st = row.status
                return (
                  <TableRow key={row.name}>
                    <TableCell className="align-top">
                      <div className="flex flex-col items-start gap-1">
                        <Link to={`/servers/${row.name}`} className="font-medium hover:underline">
                          {row.name}
                        </Link>
                        <div className="flex flex-wrap gap-1">
                          <Badge variant="outline">{row.config.transport}</Badge>
                          {keepsRunning(row) && <Badge variant="secondary">Keep running</Badge>}
                          {(row.instances?.filter((i) => i.account).length ?? 0) > 0 && (
                            <Badge variant="secondary">
                              {row.instances!.filter((i) => i.account).length} account
                              {row.instances!.filter((i) => i.account).length === 1 ? '' : 's'}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="align-top whitespace-normal">
                      <div className="flex flex-col items-start gap-1.5">
                        <ServerState status={st} enabled={row.config.enabled} />
                        {row.config.enabled && st?.state === 'error' && st.lastError && (
                          <p className="line-clamp-2 max-w-xs text-xs text-destructive" title={st.lastError}>
                            {st.lastError}
                          </p>
                        )}
                        {row.config.enabled && st?.state === 'needs-auth' && <SignInButton name={row.name} />}
                      </div>
                    </TableCell>
                    <TableCell className="hidden max-w-sm align-top md:table-cell">
                      <code
                        className="block truncate font-mono text-xs text-muted-foreground"
                        title={summary(row.config)}
                      >
                        {summary(row.config)}
                      </code>
                    </TableCell>
                    <TableCell className="text-right align-top tabular-nums">
                      {st?.toolCount !== undefined ? (
                        st.toolCount
                      ) : isDiscovering(row.config.enabled, st) ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Spinner className="size-3" />
                          Discovering…
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-right align-top font-mono text-xs text-muted-foreground sm:table-cell">
                      {st?.pid ?? '—'}
                    </TableCell>
                    <TableCell className="text-right align-top">
                      <Switch
                        checked={row.config.enabled}
                        aria-label={`${row.config.enabled ? 'Disable' : 'Enable'} ${row.name}`}
                        disabled={toggle.isPending && toggle.variables?.name === row.name}
                        onCheckedChange={() => toggle.mutate(row)}
                      />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </Page>
  )
}

function SecretHint({ form }: { form: ServerForm }) {
  const secrets = useSecrets()
  const refs = secretRefs(form)
  const missing = secrets.data ? refs.filter((r) => !secrets.data.names.includes(r)) : []
  return (
    <FieldDescription>
      Keep tokens out of the config: store them on the{' '}
      <Link to="/secrets" className="underline underline-offset-2 hover:text-foreground">
        Secrets
      </Link>{' '}
      page and write <InlineCode>secret://NAME</InlineCode> in any value.
      {missing.length > 0 && (
        <span className="mt-1 flex items-center gap-1.5 text-foreground">
          <TriangleAlertIcon className="size-3.5 text-warning" aria-hidden="true" />
          Not stored yet: {missing.map((m) => `secret://${m}`).join(', ')}.
        </span>
      )}
    </FieldDescription>
  )
}

function slugError(name: string): string | undefined {
  if (!name) return 'Enter a name'
  const r = slugSchema.safeParse(name)
  return r.success ? undefined : r.error.issues[0]?.message
}

function urlProblem(url: string): string | undefined {
  if (!url.trim()) return 'Enter a URL'
  try {
    new URL(url.trim())
    return undefined
  } catch {
    return 'Enter a full URL, including http:// or https://'
  }
}

const TRANSPORTS = [
  { value: 'stdio', label: 'stdio: a local command' },
  { value: 'http', label: 'http: Streamable HTTP (falls back to SSE)' },
  { value: 'sse', label: 'sse: legacy SSE only' },
]

/**
 * The server form's state. Returns the fields and the footer separately so the
 * page can put the actions in its sticky footer.
 */
function useServerForm({
  initial,
  existing,
  onSaved,
}: {
  initial: ServerForm
  existing: boolean
  onSaved: (name: string, test: boolean) => void
}): { fields: ReactNode; footer: ReactNode } {
  const formId = useId()
  const [form, setForm] = useState(initial)
  // Reset when the saved config changes elsewhere (another tab, the CLI).
  const initialKey = JSON.stringify(initial)
  const [synced, setSynced] = useState(initialKey)
  if (synced !== initialKey) {
    setSynced(initialKey)
    setForm(initial)
  }
  const [touched, setTouched] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [paste, setPaste] = useState('')
  const [pasteError, setPasteError] = useState<string>()
  const invalidate = useInvalidateServers()
  const set = (patch: Partial<ServerForm>) => setForm((f) => ({ ...f, ...patch }))
  const dirty = JSON.stringify(form) !== initialKey

  const save = useMutation({
    mutationFn: (_test: boolean) => put(`/servers/${enc(form.name)}`, configFromForm(form)),
    onSuccess: (_d, test) => {
      invalidate()
      toast.success(`Saved ${form.name}`)
      onSaved(form.name, test)
    },
  })

  const nameError = !existing && touched ? slugError(form.name) : undefined
  const commandError =
    touched && form.transport === 'stdio' && !form.command.trim() ? 'Enter a command' : undefined
  const urlError = touched && form.transport !== 'stdio' ? urlProblem(form.url) : undefined
  const submit = (test: boolean) => {
    setTouched(true)
    if (
      (!existing && slugError(form.name)) ||
      (form.transport === 'stdio' ? !form.command.trim() : urlProblem(form.url))
    )
      return
    save.mutate(test)
  }

  const applyPaste = () => {
    try {
      const parsed = parsePastedEntry(paste)
      setForm((f) => ({
        ...emptyForm,
        name: existing ? f.name : (parsed.name ?? f.name),
        description: f.description,
        idleTimeoutSec: f.idleTimeoutSec,
        callTimeoutSec: f.callTimeoutSec,
        ...parsed.form,
      }))
      setPasteError(undefined)
      setPasteOpen(false)
      setPaste('')
    } catch (e) {
      setPasteError(errorMessage(e))
    }
  }

  const keepRunning = form.idleTimeoutSec.trim() === '0'
  const ids = {
    name: `${formId}-name`,
    transport: `${formId}-transport`,
    description: `${formId}-description`,
    command: `${formId}-command`,
    args: `${formId}-args`,
    cwd: `${formId}-cwd`,
    url: `${formId}-url`,
    paste: `${formId}-paste`,
    idle: `${formId}-idle`,
    call: `${formId}-call`,
    keep: `${formId}-keep`,
    enabled: `${formId}-enabled`,
  }

  const fields = (
    <form
      id={formId}
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault()
        submit(false)
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle>Connection</CardTitle>
          <CardDescription>How to start or reach the server.</CardDescription>
          <CardAction>
            <Button
              size="sm"
              variant="outline"
              aria-expanded={pasteOpen}
              onClick={() => setPasteOpen((o) => !o)}
            >
              {pasteOpen ? (
                <XIcon data-icon="inline-start" />
              ) : (
                <ClipboardPasteIcon data-icon="inline-start" />
              )}
              {pasteOpen ? 'Close' : 'Paste JSON'}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {pasteOpen && (
            <Card size="sm" className="bg-muted/50">
              <CardContent className="flex flex-col gap-3">
                <Field data-invalid={!!pasteError || undefined}>
                  <FieldLabel htmlFor={ids.paste}>Client-style entry</FieldLabel>
                  <Textarea
                    id={ids.paste}
                    rows={6}
                    className="font-mono text-xs"
                    aria-invalid={!!pasteError || undefined}
                    value={paste}
                    onChange={(e) => setPaste(e.target.value)}
                    placeholder={
                      '{\n  "command": "npx",\n  "args": ["-y", "@modelcontextprotocol/server-github"],\n  "env": { "GITHUB_TOKEN": "secret://github" }\n}'
                    }
                  />
                  <FieldDescription>
                    Paste from mcp.json or similar: a bare entry with "command" or "url", or a whole{' '}
                    {'{"mcpServers": {…}}'} block.
                  </FieldDescription>
                  <FieldError>{pasteError}</FieldError>
                </Field>
                <div className="flex justify-end">
                  <Button size="sm" disabled={!paste.trim()} onClick={applyPaste}>
                    Fill the form
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
          <FieldGroup className="grid gap-6 md:grid-cols-2">
            <Field data-invalid={!!nameError || undefined} data-disabled={existing || undefined}>
              <FieldLabel htmlFor={ids.name}>Name</FieldLabel>
              <Input
                id={ids.name}
                aria-invalid={!!nameError || undefined}
                className="font-mono"
                value={form.name}
                disabled={existing}
                placeholder="github"
                autoComplete="off"
                onChange={(e) => set({ name: e.target.value })}
              />
              {nameError ? (
                <FieldError>{nameError}</FieldError>
              ) : (
                <FieldDescription>
                  {existing
                    ? 'Names cannot be changed.'
                    : 'Lowercase letters, digits, "-" and "_". Used in tool names.'}
                </FieldDescription>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor={ids.transport}>Transport</FieldLabel>
              <SimpleSelect
                id={ids.transport}
                value={form.transport}
                options={TRANSPORTS}
                onValueChange={(v) => set({ transport: v as ServerConfig['transport'] })}
              />
            </Field>
            <Field className="md:col-span-2">
              <FieldLabel htmlFor={ids.description}>Description</FieldLabel>
              <Input
                id={ids.description}
                value={form.description}
                onChange={(e) => set({ description: e.target.value })}
              />
              <FieldDescription>Optional, for your own reference.</FieldDescription>
            </Field>

            {form.transport === 'stdio' ? (
              <>
                <Field className="md:col-span-2" data-invalid={!!commandError || undefined}>
                  <FieldLabel htmlFor={ids.command}>Command</FieldLabel>
                  <Input
                    id={ids.command}
                    aria-invalid={!!commandError || undefined}
                    className="font-mono"
                    value={form.command}
                    placeholder="npx"
                    onChange={(e) => set({ command: e.target.value })}
                  />
                  <FieldError>{commandError}</FieldError>
                </Field>
                <Field>
                  <FieldLabel htmlFor={ids.args}>Arguments</FieldLabel>
                  <Textarea
                    id={ids.args}
                    rows={4}
                    className="font-mono text-xs"
                    value={form.args}
                    placeholder={'-y\n@modelcontextprotocol/server-filesystem\n/Users/me/projects'}
                    onChange={(e) => set({ args: e.target.value })}
                  />
                  <FieldDescription>One per line, no quoting needed.</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor={ids.cwd}>Working directory</FieldLabel>
                  <Input
                    id={ids.cwd}
                    className="font-mono"
                    value={form.cwd}
                    onChange={(e) => set({ cwd: e.target.value })}
                  />
                  <FieldDescription>Optional. Defaults to the daemon's directory.</FieldDescription>
                </Field>
                <Field className="md:col-span-2">
                  <FieldTitle>Environment variables</FieldTitle>
                  <KVEditor
                    rows={form.env}
                    onChange={(env) => set({ env })}
                    keyLabel="Variable"
                    valueLabel="Value"
                    keyPlaceholder="GITHUB_TOKEN"
                    valuePlaceholder="secret://github"
                    addLabel="Add variable"
                  />
                </Field>
              </>
            ) : (
              <>
                <Field className="md:col-span-2" data-invalid={!!urlError || undefined}>
                  <FieldLabel htmlFor={ids.url}>URL</FieldLabel>
                  <Input
                    id={ids.url}
                    aria-invalid={!!urlError || undefined}
                    className="font-mono"
                    value={form.url}
                    placeholder="https://mcp.example.com/mcp"
                    onChange={(e) => set({ url: e.target.value })}
                  />
                  <FieldError>{urlError}</FieldError>
                </Field>
                <Field className="md:col-span-2">
                  <FieldTitle>Headers</FieldTitle>
                  <KVEditor
                    rows={form.headers}
                    onChange={(headers) => set({ headers })}
                    keyLabel="Header"
                    valueLabel="Value"
                    keyPlaceholder="Authorization"
                    valuePlaceholder="Bearer secret://api-token"
                    addLabel="Add header"
                  />
                </Field>
              </>
            )}
            <div className="md:col-span-2">
              <SecretHint form={form} />
            </div>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lifecycle</CardTitle>
          <CardDescription>When the server runs, and how long a call may take.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor={ids.keep}>Keep running</FieldLabel>
                <FieldDescription>
                  Start with Switchboard and restart automatically if it crashes. When off, the server stops
                  after a while without calls and starts again on demand.
                </FieldDescription>
              </FieldContent>
              <Switch
                id={ids.keep}
                checked={keepRunning}
                onCheckedChange={(on) => set({ idleTimeoutSec: on ? '0' : DEFAULT_IDLE })}
              />
            </Field>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor={ids.enabled}>Enabled</FieldLabel>
                <FieldDescription>
                  {form.enabled ? 'Available to profiles.' : 'Hidden from every profile and never started.'}
                </FieldDescription>
              </FieldContent>
              <Switch
                id={ids.enabled}
                checked={form.enabled}
                onCheckedChange={(enabled) => set({ enabled })}
              />
            </Field>
            <div className="grid gap-6 sm:grid-cols-2">
              {!keepRunning && (
                <Field>
                  <FieldLabel htmlFor={ids.idle}>Idle timeout (seconds)</FieldLabel>
                  <Input
                    id={ids.idle}
                    type="number"
                    min={1}
                    value={form.idleTimeoutSec}
                    onChange={(e) => set({ idleTimeoutSec: e.target.value })}
                  />
                  <FieldDescription>Stop after this long without a call.</FieldDescription>
                </Field>
              )}
              <Field>
                <FieldLabel htmlFor={ids.call}>Call timeout (seconds)</FieldLabel>
                <Input
                  id={ids.call}
                  type="number"
                  min={1}
                  value={form.callTimeoutSec}
                  onChange={(e) => set({ callTimeoutSec: e.target.value })}
                />
                <FieldDescription>Per tool call.</FieldDescription>
              </Field>
            </div>
          </FieldGroup>
        </CardContent>
      </Card>

      {save.error && <ErrorAlert error={save.error} title="Could not save the server" />}
    </form>
  )

  const footer = (
    <>
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {existing ? (dirty ? 'Unsaved changes' : 'All changes saved') : 'New server'}
      </p>
      <div className="flex flex-wrap gap-2">
        {existing && dirty && (
          <Button variant="ghost" onClick={() => setForm(initial)}>
            Discard
          </Button>
        )}
        <Button
          type="submit"
          form={formId}
          variant="outline"
          disabled={save.isPending || (existing && !dirty)}
        >
          {save.isPending && save.variables === false && <Spinner data-icon="inline-start" />}
          Save
        </Button>
        <Button disabled={save.isPending} onClick={() => submit(true)}>
          {save.isPending && save.variables === true ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <FlaskConicalIcon data-icon="inline-start" />
          )}
          Save and test
        </Button>
      </div>
    </>
  )

  return { fields, footer }
}

export function ServerNew() {
  const { fields, footer } = useServerForm({
    initial: emptyForm,
    existing: false,
    onSaved: (name, test) =>
      navigate(`/servers/${name}?discovering=1${test ? '&test=1' : ''}`, { replace: true }),
  })
  return (
    <Page
      parent={SERVERS_CRUMB}
      title="Add server"
      description="Describe how to start or reach the server. It starts as soon as it is saved, and its tools are discovered right away."
      footer={footer}
    >
      {fields}
    </Page>
  )
}

type Tab = 'settings' | 'tools' | 'logs'

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="tabular-nums">{value}</CardTitle>
      </CardHeader>
    </Card>
  )
}

export function ServerDetail({ name }: { name: string }) {
  useTick(1000)
  const servers = useServers()
  const { query } = useLocation()
  const [tab, setTab] = useState<Tab>('settings')
  const invalidate = useInvalidateServers()
  const qc = useQueryClient()
  const row = servers.data?.find((s) => s.name === name)
  const st = row?.status

  // "Discovering tools…" after a save, until a fresh catalog arrives.
  const [discovering, setDiscovering] = useState<{ since?: string; at: number } | null>(() =>
    query.get('discovering') === '1' ? { at: Date.now() } : null,
  )
  useEffect(() => {
    if (!discovering || !row) return
    const fresh = st?.toolCount !== undefined && st.syncedAt !== discovering.since
    const stuck = st?.state === 'error' || st?.state === 'needs-auth' || !row.config.enabled
    if (fresh || stuck || Date.now() - discovering.at > 60_000) setDiscovering(null)
  })

  const test = useMutation({
    mutationFn: () => post<TestResult>(`/servers/${enc(name)}/test`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.tools(name) }),
  })
  const restart = useMutation({
    mutationFn: () =>
      post<{ ok: true; tools: number } | { ok: false; error: string; stderr?: string[] }>(
        `/servers/${enc(name)}/restart`,
      ),
    onSuccess: (r) => {
      if (r.ok) toast.success(`Restarted ${name}: ${r.tools} tools`)
      else toast.error(`Restart failed: ${r.error}`)
      void qc.invalidateQueries({ queryKey: keys.logs(name) })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const autoTest = query.get('test') === '1'
  const fromNew = query.get('discovering') === '1'
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once when arriving from the new-server form
  useEffect(() => {
    if (autoTest) test.mutate()
    if (autoTest || fromNew) navigate(`/servers/${name}`, { replace: true })
  }, [])

  const { fields, footer } = useServerForm({
    initial: row ? formFromConfig(name, row.config) : emptyForm,
    existing: true,
    onSaved: (_n, t) => {
      setDiscovering({ since: st?.syncedAt, at: Date.now() })
      if (t) test.mutate()
    },
  })

  if (servers.isPending)
    return (
      <Page parent={SERVERS_CRUMB} title={name}>
        <LoadingState />
      </Page>
    )
  if (servers.error)
    return (
      <Page parent={SERVERS_CRUMB} title={name}>
        <ErrorAlert error={servers.error} />
      </Page>
    )
  if (!row)
    return (
      <Page parent={SERVERS_CRUMB} title={name}>
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ServerIcon />
            </EmptyMedia>
            <EmptyTitle>No server named "{name}"</EmptyTitle>
            <EmptyDescription>It may have been deleted or renamed.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={() => navigate('/servers')}>
              All servers
            </Button>
          </EmptyContent>
        </Empty>
      </Page>
    )

  const wait = secondsUntil(st?.nextRestartAt)
  const enabled = row.config.enabled
  const accounts = row.instances?.filter((i) => i.account) ?? []
  // With accounts, each one signs in on its own in the Accounts card; the top card is for the server's own.
  const needsAuth = enabled && st?.state === 'needs-auth' && (!accounts.length || !st.account)
  const showDiscovering =
    enabled && (discovering !== null || (isDiscovering(enabled, st) && st?.state === 'starting'))

  return (
    <Page
      parent={SERVERS_CRUMB}
      title={name}
      description={
        <span className="flex flex-col gap-1.5">
          <ServerState status={st} enabled={enabled} />
          <code className="font-mono text-xs break-all">{summary(row.config)}</code>
        </span>
      }
      footer={tab === 'settings' ? footer : undefined}
      actions={
        <>
          {!needsAuth && (
            <Button variant="outline" disabled={test.isPending} onClick={() => test.mutate()}>
              {test.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <FlaskConicalIcon data-icon="inline-start" />
              )}
              Test
            </Button>
          )}
          <Button variant="outline" disabled={restart.isPending || !enabled} onClick={() => restart.mutate()}>
            {restart.isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <RotateCwIcon data-icon="inline-start" />
            )}
            Restart
          </Button>
          <ConfirmButton
            title={`Delete ${name}?`}
            description="The server is stopped and removed from every profile. Client configs are not touched."
            onConfirm={async () => {
              await del(`/servers/${enc(name)}`)
              invalidate()
              toast.success(`Deleted ${name}`)
              navigate('/servers')
            }}
          >
            Delete
          </ConfirmButton>
        </>
      }
    >
      {needsAuth && <SignInCard name={name} authUrl={st?.authUrl} />}

      {!needsAuth && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <Stat
            label="Tools"
            value={
              st?.toolCount ??
              (isDiscovering(enabled, st) ? (
                <span className="inline-flex items-center gap-1.5 text-sm font-normal text-muted-foreground">
                  <Spinner className="size-3.5" /> Discovering…
                </span>
              ) : (
                '—'
              ))
            }
          />
          <Stat label="PID" value={st?.pid ?? '—'} />
          <Stat label="Last used" value={relativeTime(st?.lastUsedAt)} />
          <Stat label="Catalog synced" value={relativeTime(st?.syncedAt)} />
          <Stat label="Restarts" value={st?.restarts ?? 0} />
        </div>
      )}

      {accounts.length > 0 && <AccountsCard row={row} />}

      {showDiscovering && (
        <Alert>
          <Spinner />
          <AlertTitle>Discovering tools…</AlertTitle>
          <AlertDescription>
            {name} is starting so Switchboard can read its tool list. This usually takes a few seconds.
          </AlertDescription>
        </Alert>
      )}

      {enabled && st?.state === 'error' && (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>
            Error{wait !== undefined ? ` · restarting in ${wait}s` : ''}
            {(st.restarts ?? 0) > 0 ? ` · ${st.restarts} restart${st.restarts === 1 ? '' : 's'} so far` : ''}
          </AlertTitle>
          {st.lastError && <AlertDescription className="break-words">{st.lastError}</AlertDescription>}
        </Alert>
      )}

      {(test.data || test.error) && !needsAuth && (
        <TestPanel result={test.data} error={test.error} onClose={() => test.reset()} />
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList variant="line">
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="tools">Tools</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>
        <TabsContent value="settings" className="pt-4">
          {fields}
        </TabsContent>
        <TabsContent value="tools" className="pt-4">
          <ToolsTab name={name} />
        </TabsContent>
        <TabsContent value="logs" className="pt-4">
          <LogsTab name={name} />
        </TabsContent>
      </Tabs>
    </Page>
  )
}

/** The server's own instance and every profile's separate account of it. */
function AccountsCard({ row }: { row: ServerRow }) {
  const qc = useQueryClient()
  const restart = useMutation({
    mutationFn: (id: string) =>
      post<{ ok: true; tools: number } | { ok: false; error: string }>(`/servers/${enc(id)}/restart`),
    onSuccess: (r, id) => {
      if (r.ok) toast.success(`Restarted ${id}: ${r.tools} tools`)
      else toast.error(`Restart of ${id} failed: ${r.error}`)
      void qc.invalidateQueries({ queryKey: keys.servers })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const instances = row.instances ?? []
  return (
    <Card>
      <CardHeader>
        <CardTitle>Accounts</CardTitle>
        <CardDescription>
          Profiles with their own credentials for {row.name} run it as a separate account, with its own
          process and sign-in. Set them in each profile's Credentials.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col divide-y">
        {instances.map((i) => (
          <div key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2 font-medium">
                {i.account ?? 'Default'}
                <code className="font-mono text-xs text-muted-foreground">{i.id}</code>
              </span>
              <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                {i.profiles.length
                  ? i.profiles.map((p) => (
                      <Link key={p} to={`/profiles/${p}`}>
                        <Badge variant="outline" className="hover:bg-accent">
                          {p}
                        </Badge>
                      </Link>
                    ))
                  : 'No profile uses it'}
              </span>
            </div>
            <ServerState status={i.status} enabled={row.config.enabled} />
            <span className="w-16 text-right text-sm tabular-nums text-muted-foreground">
              {i.status?.toolCount !== undefined ? `${i.status.toolCount} tools` : ''}
            </span>
            {i.status?.state === 'needs-auth' ? (
              <SignInButton name={i.id} />
            ) : (
              <Button
                size="sm"
                variant="ghost"
                disabled={!row.config.enabled || (restart.isPending && restart.variables === i.id)}
                onClick={() => restart.mutate(i.id)}
                aria-label={`Restart ${i.id}`}
              >
                <RotateCwIcon />
              </Button>
            )}
            {i.status?.state === 'error' && i.status.lastError && (
              <p className="w-full text-xs break-words text-destructive">{i.status.lastError}</p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function TestPanel({ result, error, onClose }: { result?: TestResult; error: unknown; onClose: () => void }) {
  if (error) return <ErrorAlert error={error} title="Test request failed" />
  if (!result) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <StatusDot tone={result.ok ? 'success' : 'destructive'} />
          {result.ok ? `Connected · ${result.tools.length} tools` : 'Could not connect'}
        </CardTitle>
        <CardAction>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Dismiss
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {result.ok ? (
          <ul className="flex flex-wrap gap-1.5">
            {result.tools.map((t) => (
              <li key={t.name} title={t.description}>
                <Badge variant="secondary" className="font-mono">
                  {t.name}
                </Badge>
              </li>
            ))}
          </ul>
        ) : (
          <>
            <p className="text-sm text-destructive">{result.error}</p>
            {result.stderr?.length ? <Snippet title="stderr" code={result.stderr.join('\n')} /> : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function ToolsTab({ name }: { name: string }) {
  const tools = useTools(name)
  if (tools.isPending) return <LoadingState />
  if (tools.error) return <ErrorAlert error={tools.error} />
  if (!tools.data.length)
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>No tools cached yet</EmptyTitle>
          <EmptyDescription>
            The tool list is read when the server starts. Press Test to start it now.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  return (
    <Card className="py-0">
      <ul className="divide-y">
        {tools.data.map((t) => {
          const props = Object.keys(
            ((t.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties ??
              {}) as object,
          )
          return (
            <li key={t.name} className="flex flex-col gap-0.5 px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <code className="font-mono text-sm font-medium">{t.name}</code>
                {props.length > 0 && (
                  <span className="font-mono text-xs text-muted-foreground">({props.join(', ')})</span>
                )}
              </div>
              {t.description && <p className="line-clamp-3 text-sm text-muted-foreground">{t.description}</p>}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

function LogsTab({ name }: { name: string }) {
  const logs = useLogs(name)
  if (logs.isPending) return <LoadingState />
  if (logs.error) return <ErrorAlert error={logs.error} />
  if (!logs.data.length)
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>No output</EmptyTitle>
          <EmptyDescription>Recent stderr lines from the server process show up here.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  return <Snippet title="Recent stderr" code={logs.data.join('\n')} />
}
