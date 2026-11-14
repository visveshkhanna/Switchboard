import { slugSchema } from '@switchboard/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { del, enc, errorMessage, post, put } from '../lib/api.ts'
import { KVEditor } from '../lib/kv.tsx'
import { keys, useLogs, useSecrets, useServers, useTools } from '../lib/queries.ts'
import { Link, navigate, useLocation } from '../lib/router.tsx'
import {
  configFromForm,
  emptyForm,
  formFromConfig,
  parsePastedEntry,
  type ServerForm,
  secretRefs,
  summary,
} from '../lib/serverForm.ts'
import type { ConnectionStatus, ServerConfig, ServerRow, TestResult } from '../lib/types.ts'
import {
  Badge,
  Button,
  Card,
  ConfirmButton,
  cx,
  Dot,
  EmptyState,
  ErrorBox,
  Field,
  InlineCode,
  inputClass,
  Loading,
  monoInputClass,
  PageHeader,
  relativeTime,
  Switch,
  type Tone,
  tdClass,
  thClass,
  useToast,
} from '../lib/ui.tsx'

const stateTone: Record<string, Tone> = { ready: 'ok', starting: 'warn', error: 'bad', stopped: 'neutral' }

export function StateBadge({ status, enabled }: { status?: ConnectionStatus; enabled: boolean }) {
  if (!enabled) return <Badge>disabled</Badge>
  const state = status?.state ?? 'stopped'
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <Dot tone={stateTone[state] ?? 'neutral'} pulse={state === 'starting'} />
      {state === 'stopped' ? 'idle' : state}
    </span>
  )
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
  const toast = useToast()
  return useMutation({
    mutationFn: (row: ServerRow) =>
      put(`/servers/${enc(row.name)}`, { ...row.config, enabled: !row.config.enabled }),
    onSuccess: (_d, row) => {
      invalidate()
      toast(`${row.name} ${row.config.enabled ? 'disabled' : 'enabled'}`)
    },
    onError: (e) => toast(errorMessage(e), 'bad'),
  })
}

export function ServersPage() {
  const servers = useServers()
  const toggle = useToggleEnabled()

  return (
    <>
      <PageHeader
        title="Servers"
        description="The MCP servers the daemon can start. Each one runs once and is shared by every client; idle servers are stopped."
        actions={
          <>
            <Button onClick={() => navigate('/import')}>Import</Button>
            <Button variant="primary" onClick={() => navigate('/servers/new')}>
              Add server
            </Button>
          </>
        }
      />
      {servers.isPending ? (
        <Loading />
      ) : servers.error ? (
        <ErrorBox error={servers.error} />
      ) : !servers.data.length ? (
        <EmptyState
          title="No servers yet"
          action={
            <>
              <Button variant="primary" onClick={() => navigate('/import')}>
                Import from your clients
              </Button>
              <Button onClick={() => navigate('/servers/new')}>Add manually</Button>
            </>
          }
        >
          Import the servers you already use in Cursor, Claude Code or VS Code, or add one by command or URL.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-panel shadow-xs">
          <table className="w-full text-sm">
            <thead className="border-b border-line">
              <tr>
                <th className={thClass}>Name</th>
                <th className={thClass}>Status</th>
                <th className={`${thClass} hidden md:table-cell`}>Command / URL</th>
                <th className={`${thClass} text-right`}>Tools</th>
                <th className={`${thClass} hidden sm:table-cell`}>PID</th>
                <th className={`${thClass} text-right`}>Enabled</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {servers.data.map((row) => (
                <tr key={row.name} className="hover:bg-subtle/60">
                  <td className={tdClass}>
                    <Link to={`/servers/${row.name}`} className="font-medium text-fg hover:text-accent">
                      {row.name}
                    </Link>
                    <div className="mt-0.5">
                      <Badge>{row.config.transport}</Badge>
                    </div>
                  </td>
                  <td className={tdClass}>
                    <StateBadge status={row.status} enabled={row.config.enabled} />
                    {row.status?.lastError && (
                      <p className="mt-1 line-clamp-2 max-w-xs text-xs text-bad" title={row.status.lastError}>
                        {row.status.lastError}
                      </p>
                    )}
                  </td>
                  <td className={`${tdClass} hidden max-w-sm md:table-cell`}>
                    <code className="block truncate font-mono text-xs text-muted" title={summary(row.config)}>
                      {summary(row.config)}
                    </code>
                  </td>
                  <td className={`${tdClass} text-right tabular-nums`}>{row.status?.toolCount ?? '—'}</td>
                  <td className={`${tdClass} hidden font-mono text-xs text-muted sm:table-cell`}>
                    {row.status?.pid ?? '—'}
                  </td>
                  <td className={`${tdClass} text-right`}>
                    <Switch
                      checked={row.config.enabled}
                      label={`${row.config.enabled ? 'Disable' : 'Enable'} ${row.name}`}
                      disabled={toggle.isPending && toggle.variables?.name === row.name}
                      onChange={() => toggle.mutate(row)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function SecretHint({ form }: { form: ServerForm }) {
  const secrets = useSecrets()
  const refs = secretRefs(form)
  const missing = secrets.data ? refs.filter((r) => !secrets.data.names.includes(r)) : []
  return (
    <p className="text-xs text-muted">
      Keep tokens out of the config: store them on the{' '}
      <Link to="/secrets" className="text-accent hover:underline">
        Secrets
      </Link>{' '}
      page and write <InlineCode>secret://NAME</InlineCode> in any value.
      {missing.length > 0 && (
        <span className="mt-1 block text-warn">
          Not stored yet: {missing.map((m) => `secret://${m}`).join(', ')}.
        </span>
      )}
    </p>
  )
}

function ServerFormView({
  initial,
  existing,
  onSaved,
}: {
  initial: ServerForm
  existing: boolean
  onSaved: (name: string, test: boolean) => void
}) {
  const [form, setForm] = useState(initial)
  const [touched, setTouched] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [paste, setPaste] = useState('')
  const [pasteError, setPasteError] = useState<string>()
  const invalidate = useInvalidateServers()
  const toast = useToast()
  const set = (patch: Partial<ServerForm>) => setForm((f) => ({ ...f, ...patch }))

  const save = useMutation({
    mutationFn: (_test: boolean) => put(`/servers/${enc(form.name)}`, configFromForm(form)),
    onSuccess: (_d, test) => {
      invalidate()
      toast(`Saved ${form.name}`, 'ok')
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

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault()
        submit(false)
      }}
    >
      <Card
        title="Connection"
        actions={
          <Button size="sm" variant="ghost" aria-expanded={pasteOpen} onClick={() => setPasteOpen((o) => !o)}>
            {pasteOpen ? 'Close' : 'Paste JSON'}
          </Button>
        }
      >
        {pasteOpen && (
          <div className="mb-5 rounded-md border border-line bg-subtle p-3">
            <Field
              label="Client-style entry"
              hint='Paste from mcp.json or similar: {"command": "npx", "args": ["-y", "pkg"]}, {"url": "https://…"}, or a whole {"mcpServers": {…}} block.'
              error={pasteError}
            >
              {(id, d) => (
                <textarea
                  id={id}
                  aria-describedby={d}
                  rows={6}
                  className={monoInputClass}
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  placeholder={
                    '{\n  "command": "npx",\n  "args": ["-y", "@modelcontextprotocol/server-github"],\n  "env": { "GITHUB_TOKEN": "secret://github" }\n}'
                  }
                />
              )}
            </Field>
            <div className="mt-2 flex justify-end">
              <Button size="sm" variant="primary" disabled={!paste.trim()} onClick={applyPaste}>
                Fill the form
              </Button>
            </div>
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field
            label="Name"
            hint={
              existing
                ? 'Names cannot be changed.'
                : 'Lowercase letters, digits, "-" and "_". Used in tool names.'
            }
            error={nameError}
          >
            {(id, d) => (
              <input
                id={id}
                aria-describedby={d}
                aria-invalid={!!nameError}
                className={monoInputClass}
                value={form.name}
                disabled={existing}
                placeholder="github"
                autoComplete="off"
                onChange={(e) => set({ name: e.target.value })}
              />
            )}
          </Field>
          <Field label="Transport">
            {(id) => (
              <select
                id={id}
                className={inputClass}
                value={form.transport}
                onChange={(e) => set({ transport: e.target.value as ServerConfig['transport'] })}
              >
                <option value="stdio">stdio: a local command</option>
                <option value="http">http: Streamable HTTP (falls back to SSE)</option>
                <option value="sse">sse: legacy SSE only</option>
              </select>
            )}
          </Field>
          <Field label="Description" className="md:col-span-2" hint="Optional, for your own reference.">
            {(id, d) => (
              <input
                id={id}
                aria-describedby={d}
                className={inputClass}
                value={form.description}
                onChange={(e) => set({ description: e.target.value })}
              />
            )}
          </Field>

          {form.transport === 'stdio' ? (
            <>
              <Field label="Command" error={commandError} className="md:col-span-2">
                {(id, d) => (
                  <input
                    id={id}
                    aria-describedby={d}
                    aria-invalid={!!commandError}
                    className={monoInputClass}
                    value={form.command}
                    placeholder="npx"
                    onChange={(e) => set({ command: e.target.value })}
                  />
                )}
              </Field>
              <Field label="Arguments" hint="One per line, no quoting needed.">
                {(id, d) => (
                  <textarea
                    id={id}
                    aria-describedby={d}
                    rows={4}
                    className={monoInputClass}
                    value={form.args}
                    placeholder={'-y\n@modelcontextprotocol/server-filesystem\n/Users/me/projects'}
                    onChange={(e) => set({ args: e.target.value })}
                  />
                )}
              </Field>
              <Field label="Working directory" hint="Optional. Defaults to the daemon's directory.">
                {(id, d) => (
                  <input
                    id={id}
                    aria-describedby={d}
                    className={monoInputClass}
                    value={form.cwd}
                    onChange={(e) => set({ cwd: e.target.value })}
                  />
                )}
              </Field>
              <div className="md:col-span-2">
                <p className="mb-1 text-xs font-medium">Environment variables</p>
                <KVEditor
                  rows={form.env}
                  onChange={(env) => set({ env })}
                  keyLabel="Variable"
                  valueLabel="Value"
                  keyPlaceholder="GITHUB_TOKEN"
                  valuePlaceholder="secret://github"
                  addLabel="Add variable"
                />
              </div>
            </>
          ) : (
            <>
              <Field label="URL" error={urlError} className="md:col-span-2">
                {(id, d) => (
                  <input
                    id={id}
                    aria-describedby={d}
                    aria-invalid={!!urlError}
                    className={monoInputClass}
                    value={form.url}
                    placeholder="https://mcp.example.com/mcp"
                    onChange={(e) => set({ url: e.target.value })}
                  />
                )}
              </Field>
              <div className="md:col-span-2">
                <p className="mb-1 text-xs font-medium">Headers</p>
                <KVEditor
                  rows={form.headers}
                  onChange={(headers) => set({ headers })}
                  keyLabel="Header"
                  valueLabel="Value"
                  keyPlaceholder="Authorization"
                  valuePlaceholder="Bearer secret://api-token"
                  addLabel="Add header"
                />
              </div>
            </>
          )}
          <div className="md:col-span-2">
            <SecretHint form={form} />
          </div>
        </div>
      </Card>

      <Card title="Lifecycle">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field
            label="Idle timeout (seconds)"
            hint="Stop after this long without a call. 0 keeps it running."
          >
            {(id, d) => (
              <input
                id={id}
                aria-describedby={d}
                type="number"
                min={0}
                className={inputClass}
                value={form.idleTimeoutSec}
                onChange={(e) => set({ idleTimeoutSec: e.target.value })}
              />
            )}
          </Field>
          <Field label="Call timeout (seconds)" hint="Per tool call.">
            {(id, d) => (
              <input
                id={id}
                aria-describedby={d}
                type="number"
                min={1}
                className={inputClass}
                value={form.callTimeoutSec}
                onChange={(e) => set({ callTimeoutSec: e.target.value })}
              />
            )}
          </Field>
          <div>
            <p className="mb-1 text-xs font-medium">Enabled</p>
            <div className="flex h-8 items-center gap-2 text-sm text-muted">
              <Switch checked={form.enabled} onChange={(enabled) => set({ enabled })} label="Enabled" />
              {form.enabled ? 'Available to profiles' : 'Hidden from every profile'}
            </div>
          </div>
        </div>
      </Card>

      {save.error && <ErrorBox error={save.error} title="Could not save the server" />}
      <div className="flex justify-end gap-2">
        <Button type="submit" loading={save.isPending && save.variables === false}>
          Save
        </Button>
        <Button
          variant="primary"
          loading={save.isPending && save.variables === true}
          onClick={() => submit(true)}
        >
          Save and test
        </Button>
      </div>
    </form>
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

export function ServerNew() {
  return (
    <>
      <PageHeader
        back={<Link to="/servers">← Servers</Link>}
        title="Add server"
        description="Describe how to start or reach the server. It is started on the first tool call, not when saved."
      />
      <ServerFormView
        initial={emptyForm}
        existing={false}
        onSaved={(name, test) => navigate(`/servers/${name}${test ? '?test=1' : ''}`, { replace: true })}
      />
    </>
  )
}

type Tab = 'settings' | 'tools' | 'logs'

export function ServerDetail({ name }: { name: string }) {
  const servers = useServers()
  const { query } = useLocation()
  const [tab, setTab] = useState<Tab>('settings')
  const invalidate = useInvalidateServers()
  const toast = useToast()
  const qc = useQueryClient()

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
      if (r.ok) toast(`Restarted ${name}: ${r.tools} tools`, 'ok')
      else toast(`Restart failed: ${r.error}`, 'bad')
      void qc.invalidateQueries({ queryKey: keys.logs(name) })
    },
    onError: (e) => toast(errorMessage(e), 'bad'),
  })

  const autoTest = query.get('test') === '1'
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once when arriving from "Save and test"
  useEffect(() => {
    if (autoTest) {
      test.mutate()
      navigate(`/servers/${name}`, { replace: true })
    }
  }, [autoTest])

  if (servers.isPending) return <Loading />
  if (servers.error) return <ErrorBox error={servers.error} />
  const row = servers.data.find((s) => s.name === name)
  if (!row)
    return (
      <EmptyState
        title={`No server named "${name}"`}
        action={<Button onClick={() => navigate('/servers')}>All servers</Button>}
      >
        It may have been deleted or renamed.
      </EmptyState>
    )
  const st = row.status

  return (
    <>
      <PageHeader
        back={<Link to="/servers">← Servers</Link>}
        title={
          <span className="flex items-center gap-3">
            {name}
            <StateBadge status={st} enabled={row.config.enabled} />
          </span>
        }
        description={<span className="font-mono text-xs">{summary(row.config)}</span>}
        actions={
          <>
            <Button loading={test.isPending} onClick={() => test.mutate()}>
              Test
            </Button>
            <Button
              loading={restart.isPending}
              onClick={() => restart.mutate()}
              disabled={!row.config.enabled}
            >
              Restart
            </Button>
            <ConfirmButton
              title={`Delete ${name}?`}
              body="The server is stopped and removed from every profile. Client configs are not touched."
              onConfirm={async () => {
                await del(`/servers/${enc(name)}`)
                invalidate()
                toast(`Deleted ${name}`)
                navigate('/servers')
              }}
            >
              Delete
            </ConfirmButton>
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        {[
          ['Tools', st?.toolCount ?? '—'],
          ['PID', st?.pid ?? '—'],
          ['Last used', relativeTime(st?.lastUsedAt)],
          ['Catalog synced', relativeTime(st?.syncedAt)],
        ].map(([k, v]) => (
          <div key={k as string} className="rounded-lg border border-line bg-panel px-3 py-2">
            <div className="text-xs text-muted">{k}</div>
            <div className="mt-0.5 font-medium tabular-nums">{v}</div>
          </div>
        ))}
      </div>

      {st?.lastError && (
        <div className="mb-5">
          <ErrorBox error={new Error(st.lastError)} title="Last error" />
        </div>
      )}

      {(test.data || test.error) && (
        <div className="mb-5">
          <TestPanel result={test.data} error={test.error} onClose={() => test.reset()} />
        </div>
      )}

      <div role="tablist" aria-label="Server sections" className="mb-4 flex gap-1 border-b border-line">
        {(['settings', 'tools', 'logs'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cx(
              '-mb-px border-b-2 px-3 py-2 text-sm capitalize',
              tab === t ? 'border-accent font-medium text-fg' : 'border-transparent text-muted hover:text-fg',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'settings' && (
        <ServerFormView
          key={JSON.stringify(row.config)}
          initial={formFromConfig(name, row.config)}
          existing
          onSaved={(_n, t) => (t ? test.mutate() : undefined)}
        />
      )}
      {tab === 'tools' && <ToolsTab name={name} />}
      {tab === 'logs' && <LogsTab name={name} />}
    </>
  )
}

function TestPanel({ result, error, onClose }: { result?: TestResult; error: unknown; onClose: () => void }) {
  if (error) return <ErrorBox error={error} title="Test request failed" />
  if (!result) return null
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Dot tone={result.ok ? 'ok' : 'bad'} />
          {result.ok ? `Connected · ${result.tools.length} tools` : 'Could not connect'}
        </span>
      }
      actions={
        <Button size="sm" variant="ghost" onClick={onClose}>
          Dismiss
        </Button>
      }
    >
      {result.ok ? (
        <ul className="flex flex-wrap gap-1.5">
          {result.tools.map((t) => (
            <li key={t.name} title={t.description}>
              <InlineCode>{t.name}</InlineCode>
            </li>
          ))}
        </ul>
      ) : (
        <>
          <p className="text-sm text-bad">{result.error}</p>
          {result.stderr?.length ? (
            <pre className="mt-3 max-h-64 overflow-auto rounded-md bg-subtle p-3 font-mono text-xs text-muted">
              {result.stderr.join('\n')}
            </pre>
          ) : null}
        </>
      )}
    </Card>
  )
}

function ToolsTab({ name }: { name: string }) {
  const tools = useTools(name)
  if (tools.isPending) return <Loading />
  if (tools.error) return <ErrorBox error={tools.error} />
  if (!tools.data.length)
    return (
      <EmptyState title="No tools cached yet">
        The tool list is read the first time the server starts. Press <strong>Test</strong> to start it now.
      </EmptyState>
    )
  return (
    <div className="divide-y divide-line rounded-lg border border-line bg-panel">
      {tools.data.map((t) => {
        const props = Object.keys(
          ((t.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties ??
            {}) as object,
        )
        return (
          <div key={t.name} className="px-4 py-3">
            <div className="flex flex-wrap items-baseline gap-2">
              <code className="font-mono text-sm font-medium">{t.name}</code>
              {props.length > 0 && <span className="font-mono text-xs text-faint">({props.join(', ')})</span>}
            </div>
            {t.description && <p className="mt-0.5 line-clamp-3 text-sm text-muted">{t.description}</p>}
          </div>
        )
      })}
    </div>
  )
}

function LogsTab({ name }: { name: string }) {
  const logs = useLogs(name)
  if (logs.isPending) return <Loading />
  if (logs.error) return <ErrorBox error={logs.error} />
  if (!logs.data.length)
    return (
      <EmptyState title="No output">Recent stderr lines from the server process show up here.</EmptyState>
    )
  return (
    <pre className="max-h-[32rem] overflow-auto rounded-lg border border-line bg-subtle p-4 font-mono text-xs leading-5 text-fg">
      {logs.data.join('\n')}
    </pre>
  )
}
