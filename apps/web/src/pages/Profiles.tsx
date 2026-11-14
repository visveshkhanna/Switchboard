import { brand, type Profile, profileSchema, type Surface, slugSchema } from '@switchboard/shared'
import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { del, enc, get, post, put } from '../lib/api.ts'
import { candidateServers, PATTERN_RE, setTool, toolState } from '../lib/profileTools.ts'
import { keys, useConfig, useServers, useStatus } from '../lib/queries.ts'
import { Link, navigate } from '../lib/router.tsx'
import type { Preview, ToolDef } from '../lib/types.ts'
import {
  Badge,
  Button,
  Card,
  ConfirmButton,
  CopyButton,
  cx,
  EmptyState,
  ErrorBox,
  Field,
  InlineCode,
  inputClass,
  Loading,
  monoInputClass,
  PageHeader,
  Spinner,
  Switch,
  useToast,
} from '../lib/ui.tsx'
import { StateBadge } from './Servers.tsx'

export function endpointUrl(port: number | undefined, profile: string): string {
  return `http://127.0.0.1:${port ?? brand.defaultPort}/p/${profile}/mcp`
}

const SURFACES: { value: Surface; title: string; body: string }[] = [
  {
    value: 'auto',
    title: 'Auto',
    body: 'Passthrough while the profile is small, meta-tools above the threshold.',
  },
  {
    value: 'passthrough',
    title: 'Passthrough',
    body: 'Every allowed tool is listed as is. Best for a few dozen tools.',
  },
  {
    value: 'meta',
    title: 'Meta-tools',
    body: 'Clients see search_tools, get_schema and call_tool, and look tools up on demand.',
  },
  {
    value: 'code',
    title: 'Code mode',
    body: 'One execute tool: the model writes JavaScript that calls tools inside a sandbox.',
  },
]

export function ProfilesPage() {
  const config = useConfig()
  const status = useStatus()
  if (config.isPending) return <Loading />
  if (config.error) return <ErrorBox error={config.error} />
  const profiles = Object.entries(config.data.profiles)
  return (
    <>
      <PageHeader
        title="Profiles"
        description="A profile is a set of servers and tools served at its own endpoint. Point each client at the profile it should see."
        actions={
          <Button variant="primary" onClick={() => navigate('/profiles/new')}>
            New profile
          </Button>
        }
      />
      {!profiles.length ? (
        <EmptyState
          title="No profiles yet"
          action={
            <Button variant="primary" onClick={() => navigate('/profiles/new')}>
              Create a profile
            </Button>
          }
        >
          {Object.keys(config.data.servers).length
            ? 'Create one, such as "personal" or "work", and pick the servers it includes.'
            : 'Add or import a few servers first, then group them into a profile.'}
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {profiles.map(([name, p]) => {
            const url = endpointUrl(status.data?.port, name)
            return (
              <div key={name} className="rounded-lg border border-line bg-panel p-4 shadow-xs">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link to={`/profiles/${name}`} className="text-[15px] font-semibold hover:text-accent">
                      {name}
                    </Link>
                    {config.data.defaultProfile === name && (
                      <span className="ml-2">
                        <Badge tone="accent">default</Badge>
                      </span>
                    )}
                    {p.description && <p className="mt-0.5 text-sm text-muted">{p.description}</p>}
                  </div>
                  <Badge>{p.surface}</Badge>
                </div>
                <p className="mt-3 text-xs text-muted">
                  {p.servers.length ? p.servers.join(', ') : 'no servers'}
                  {p.include.length > 0 && ` · +${p.include.length} included`}
                  {p.exclude.length > 0 && ` · −${p.exclude.length} excluded`}
                </p>
                <div className="mt-3 flex items-center justify-between gap-2 rounded-md bg-subtle py-0.5 pr-0.5 pl-2.5">
                  <code className="truncate font-mono text-xs">{url}</code>
                  <CopyButton text={url} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export function ProfileEditor({ name }: { name?: string }) {
  const config = useConfig()
  if (config.isPending) return <Loading />
  if (config.error) return <ErrorBox error={config.error} />
  const saved = name ? config.data.profiles[name] : undefined
  if (name && !saved)
    return (
      <EmptyState
        title={`No profile named "${name}"`}
        action={<Button onClick={() => navigate('/profiles')}>All profiles</Button>}
      >
        It may have been deleted.
      </EmptyState>
    )
  return (
    <Editor
      name={name}
      saved={saved ?? profileSchema.parse({})}
      serverNames={Object.keys(config.data.servers)}
    />
  )
}

function Editor({ name, saved, serverNames }: { name?: string; saved: Profile; serverNames: string[] }) {
  const isNew = !name
  const [draft, setDraft] = useState<Profile>(saved)
  const [newName, setNewName] = useState('')
  const [touched, setTouched] = useState(false)
  const status = useStatus()
  const servers = useServers()
  const qc = useQueryClient()
  const toast = useToast()
  const set = (patch: Partial<Profile>) => setDraft((d) => ({ ...d, ...patch }))

  const profileName = name ?? newName
  const nameCheck = slugSchema.safeParse(newName)
  const nameError =
    isNew && touched && !nameCheck.success
      ? newName
        ? nameCheck.error.issues[0]?.message
        : 'Enter a name'
      : undefined
  const dirty = isNew || JSON.stringify(draft) !== JSON.stringify(saved)

  const body = useMemo(() => cleanDraft(draft), [draft])
  const debounced = useDebounced(body, 350)
  const previewName = name ?? (nameCheck.success ? newName : 'draft-preview')
  const preview = useQuery({
    queryKey: ['preview', previewName, debounced],
    queryFn: () => post<Preview>(`/profiles/${enc(previewName)}/preview`, debounced),
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 0,
  })

  const save = useMutation({
    mutationFn: () => put(`/profiles/${enc(profileName)}`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.config })
      void qc.invalidateQueries({ queryKey: keys.status })
      toast(`Saved ${profileName}`, 'ok')
      if (isNew) navigate(`/profiles/${profileName}`, { replace: true })
    },
  })

  const candidates = candidateServers(draft, serverNames)
  const toolQueries = useQueries({
    queries: candidates.map((s) => ({
      queryKey: keys.tools(s),
      queryFn: () => get<ToolDef[]>(`/servers/${enc(s)}/tools`),
    })),
  })
  // The preview runs the catalog sync for listed servers; refresh tool lists when it lands.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on preview data only
  useEffect(() => {
    if (preview.data) for (const s of candidates) void qc.invalidateQueries({ queryKey: keys.tools(s) })
  }, [preview.dataUpdatedAt])

  const exposed = new Map(preview.data?.tools.map((t) => [t.id, t.name]))
  const url = endpointUrl(status.data?.port, profileName || '<name>')

  return (
    <>
      <PageHeader
        back={<Link to="/profiles">← Profiles</Link>}
        title={isNew ? 'New profile' : name}
        description={
          isNew ? 'Choose servers and tools, then save to get an endpoint.' : saved.description || undefined
        }
        actions={
          <>
            {!isNew && (
              <ConfirmButton
                title={`Delete profile "${name}"?`}
                body="Clients using its endpoint stop working, and client rules pointing at it are removed. Servers are kept."
                onConfirm={async () => {
                  await del(`/profiles/${enc(name)}`)
                  void qc.invalidateQueries({ queryKey: keys.config })
                  toast(`Deleted ${name}`)
                  navigate('/profiles')
                }}
              >
                Delete
              </ConfirmButton>
            )}
            {!isNew && dirty && <Button onClick={() => setDraft(saved)}>Discard changes</Button>}
            <Button
              variant="primary"
              disabled={!dirty}
              loading={save.isPending}
              onClick={() => {
                setTouched(true)
                if (isNew && !nameCheck.success) return
                save.mutate()
              }}
            >
              {isNew ? 'Create profile' : 'Save'}
            </Button>
          </>
        }
      />
      {save.error && (
        <div className="mb-4">
          <ErrorBox error={save.error} title="Could not save the profile" />
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          <Card title="General">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {isNew && (
                <Field label="Name" error={nameError} hint="Lowercase, used in the endpoint URL.">
                  {(id, d) => (
                    <input
                      id={id}
                      aria-describedby={d}
                      aria-invalid={!!nameError}
                      className={monoInputClass}
                      value={newName}
                      placeholder="work"
                      autoComplete="off"
                      onChange={(e) => setNewName(e.target.value)}
                    />
                  )}
                </Field>
              )}
              <Field label="Description" className={isNew ? '' : 'md:col-span-2'}>
                {(id) => (
                  <input
                    id={id}
                    className={inputClass}
                    value={draft.description ?? ''}
                    placeholder="Tools for client work"
                    onChange={(e) => set({ description: e.target.value || undefined })}
                  />
                )}
              </Field>
              <div className="md:col-span-2">
                <p className="mb-1 text-xs font-medium">Endpoint</p>
                <div className="flex items-center justify-between gap-2 rounded-md border border-line bg-subtle py-0.5 pr-0.5 pl-2.5">
                  <code className="truncate font-mono text-xs">{url}</code>
                  {!isNew && <CopyButton text={url} />}
                </div>
                <p className="mt-1 text-xs text-muted">
                  {isNew ? 'Available once the profile is saved. ' : ''}
                  <Link to="/clients" className="text-accent hover:underline">
                    Connect a client
                  </Link>{' '}
                  to write it into its config.
                </p>
              </div>
            </div>
          </Card>

          <Card
            title="Servers"
            description="Every tool of a checked server is included, minus exclusions below."
          >
            {!serverNames.length ? (
              <EmptyState
                title="No servers to choose from"
                action={
                  <Button size="sm" onClick={() => navigate('/import')}>
                    Import servers
                  </Button>
                }
              >
                Add or import servers first.
              </EmptyState>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {serverNames.map((s) => {
                  const row = servers.data?.find((r) => r.name === s)
                  const checked = draft.servers.includes(s)
                  return (
                    <label
                      key={s}
                      className={cx(
                        'flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-sm',
                        checked ? 'border-accent/50 bg-accent/5' : 'border-line hover:bg-subtle',
                      )}
                    >
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--sb-accent)]"
                        checked={checked}
                        onChange={(e) =>
                          set({
                            servers: e.target.checked
                              ? [...draft.servers, s]
                              : draft.servers.filter((x) => x !== s),
                          })
                        }
                      />
                      <span className="min-w-0 flex-1 truncate font-medium">{s}</span>
                      {row && <StateBadge status={row.status} enabled={row.config.enabled} />}
                    </label>
                  )
                })}
              </div>
            )}
          </Card>

          <ToolsCard
            draft={draft}
            setDraft={setDraft}
            candidates={candidates}
            tools={Object.fromEntries(candidates.map((s, i) => [s, toolQueries[i]]))}
            exposed={exposed}
          />

          <Card
            title="Patterns"
            description={
              <>
                <InlineCode>server.tool</InlineCode>, <InlineCode>server.*</InlineCode> or globs like{' '}
                <InlineCode>git*.list_*</InlineCode>. Exclusions are applied last and always win.
              </>
            }
          >
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <PatternList
                label="Include"
                hint="Extra tools from servers not checked above."
                values={draft.include}
                onChange={(include) => set({ include })}
              />
              <PatternList
                label="Exclude"
                hint="Tools removed from this profile."
                values={draft.exclude}
                onChange={(exclude) => set({ exclude })}
              />
            </div>
          </Card>

          <SurfaceCard draft={draft} set={set} />
        </div>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <PreviewPanel preview={preview.data} error={preview.error} fetching={preview.isFetching} />
        </aside>
      </div>
    </>
  )
}

/** Drop empty overrides so the saved config stays tidy. */
function cleanDraft(p: Profile): Profile {
  const overrides = Object.fromEntries(
    Object.entries(p.overrides)
      .map(
        ([k, o]) =>
          [
            k,
            { ...(o.name ? { name: o.name } : {}), ...(o.description ? { description: o.description } : {}) },
          ] as const,
      )
      .filter(([, o]) => Object.keys(o).length > 0),
  )
  return { ...p, overrides }
}

function ToolsCard({
  draft,
  setDraft,
  candidates,
  tools,
  exposed,
}: {
  draft: Profile
  setDraft: (fn: (p: Profile) => Profile) => void
  candidates: string[]
  tools: Record<string, { data?: ToolDef[]; isPending: boolean } | undefined>
  exposed: Map<string, string>
}) {
  const [filter, setFilter] = useState('')
  const [editing, setEditing] = useState<string>()
  const f = filter.trim().toLowerCase()

  return (
    <Card
      title="Tools"
      description="Switch single tools on or off; this edits the include and exclude lists for you."
      actions={
        candidates.length > 0 && (
          <input
            aria-label="Filter tools"
            placeholder="Filter…"
            className={`${inputClass} h-7 w-40 py-0.5 text-xs`}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        )
      }
      bodyClassName="divide-y divide-line"
    >
      {!candidates.length && (
        <p className="px-4 py-6 text-center text-sm text-muted">Check a server above to see its tools.</p>
      )}
      {candidates.map((server) => {
        const q = tools[server]
        const list = (q?.data ?? []).filter(
          (t) => !f || t.name.toLowerCase().includes(f) || t.description?.toLowerCase().includes(f),
        )
        const states = (q?.data ?? []).map((t) => toolState(draft, server, t.name))
        const on = states.filter((s) => s.active).length
        return (
          <div key={server}>
            <div className="flex items-center justify-between bg-subtle/60 px-4 py-1.5">
              <span className="text-xs font-semibold">{server}</span>
              <span className="text-xs text-muted">{q?.data ? `${on} of ${q.data.length} on` : ''}</span>
            </div>
            {q?.isPending ? (
              <div className="px-4 py-3 text-xs text-muted">
                <Spinner className="mr-1 inline" /> Loading tools…
              </div>
            ) : !q?.data?.length ? (
              <p className="px-4 py-3 text-xs text-muted">
                No tools cached yet. They load when the server first starts;{' '}
                <Link to={`/servers/${server}`} className="text-accent hover:underline">
                  test {server}
                </Link>{' '}
                to load them now.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {list.map((t) => {
                  const id = `${server}.${t.name}`
                  const st = toolState(draft, server, t.name)
                  const override = draft.overrides[id]
                  const blocked = !st.active && st.blockedBy.length > 0
                  return (
                    <li key={id} className="px-4 py-2">
                      <div className="flex items-start gap-3">
                        <div className="pt-0.5">
                          <Switch
                            size="sm"
                            checked={st.active}
                            disabled={blocked}
                            label={
                              blocked ? `${id} is excluded by ${st.blockedBy.join(', ')}` : `Include ${id}`
                            }
                            onChange={(next) => setDraft((p) => setTool(p, server, t.name, next))}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-x-2">
                            <code className={cx('font-mono text-[13px]', !st.active && 'text-faint')}>
                              {t.name}
                            </code>
                            {st.active && exposed.get(id) && (
                              <span className="font-mono text-[11px] text-faint">as {exposed.get(id)}</span>
                            )}
                            {override && (override.name || override.description) && (
                              <Badge tone="accent">edited</Badge>
                            )}
                            {blocked && <Badge tone="warn">excluded by {st.blockedBy.join(', ')}</Badge>}
                          </div>
                          {t.description && (
                            <p className="line-clamp-1 text-xs text-muted" title={t.description}>
                              {override?.description || t.description}
                            </p>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-expanded={editing === id}
                          onClick={() => setEditing(editing === id ? undefined : id)}
                        >
                          {editing === id ? 'Done' : 'Customize'}
                        </Button>
                      </div>
                      {editing === id && (
                        <div className="mt-2 grid grid-cols-1 gap-3 rounded-md bg-subtle p-3 md:grid-cols-2">
                          <Field
                            label="Name shown to clients"
                            hint={`Default: ${exposed.get(id) ?? `${server}__${t.name}`}`}
                          >
                            {(fid, d) => (
                              <input
                                id={fid}
                                aria-describedby={d}
                                className={monoInputClass}
                                value={override?.name ?? ''}
                                onChange={(e) =>
                                  setDraft((p) => ({
                                    ...p,
                                    overrides: {
                                      ...p.overrides,
                                      [id]: { ...p.overrides[id], name: e.target.value },
                                    },
                                  }))
                                }
                              />
                            )}
                          </Field>
                          <Field label="Description" hint="Leave empty to keep the server's.">
                            {(fid, d) => (
                              <textarea
                                id={fid}
                                aria-describedby={d}
                                rows={2}
                                className={inputClass}
                                value={override?.description ?? ''}
                                placeholder={t.description}
                                onChange={(e) =>
                                  setDraft((p) => ({
                                    ...p,
                                    overrides: {
                                      ...p.overrides,
                                      [id]: { ...p.overrides[id], description: e.target.value },
                                    },
                                  }))
                                }
                              />
                            )}
                          </Field>
                        </div>
                      )}
                    </li>
                  )
                })}
                {!list.length && <li className="px-4 py-2 text-xs text-muted">No tools match “{filter}”.</li>}
              </ul>
            )}
          </div>
        )
      })}
    </Card>
  )
}

function PatternList({
  label,
  hint,
  values,
  onChange,
}: {
  label: string
  hint: string
  values: string[]
  onChange: (v: string[]) => void
}) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string>()
  const add = () => {
    const v = text.trim()
    if (!v) return
    if (!PATTERN_RE.test(v)) return setError('Use "server.tool" or "server.*".')
    if (values.includes(v)) return setError('Already in the list.')
    onChange([...values, v])
    setText('')
    setError(undefined)
  }
  return (
    <div>
      <Field label={label} hint={hint} error={error}>
        {(id, d) => (
          <div className="flex gap-1.5">
            <input
              id={id}
              aria-describedby={d}
              aria-invalid={!!error}
              className={monoInputClass}
              value={text}
              placeholder="github.delete_*"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  add()
                }
              }}
            />
            <Button onClick={add}>Add</Button>
          </div>
        )}
      </Field>
      {values.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {values.map((v) => (
            <li
              key={v}
              className="inline-flex items-center gap-1 rounded border border-line bg-subtle py-0.5 pr-0.5 pl-2 font-mono text-xs"
            >
              {v}
              <button
                type="button"
                aria-label={`Remove ${v}`}
                className="rounded px-1 text-muted hover:bg-line hover:text-fg"
                onClick={() => onChange(values.filter((x) => x !== v))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function NumberField({
  label,
  hint,
  value,
  onChange,
  min,
}: {
  label: string
  hint?: ReactNode
  value: number
  onChange: (n: number) => void
  min?: number
}) {
  return (
    <Field label={label} hint={hint}>
      {(id, d) => (
        <input
          id={id}
          aria-describedby={d}
          type="number"
          min={min}
          className={inputClass}
          value={Number.isFinite(value) ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? Number.NaN : Number(e.target.value))}
        />
      )}
    </Field>
  )
}

function SurfaceCard({ draft, set }: { draft: Profile; set: (p: Partial<Profile>) => void }) {
  const b = draft.budgets
  const setBudget = (patch: Partial<Profile['budgets']>) => set({ budgets: { ...b, ...patch } })
  return (
    <Card title="Tool surface" description="How this profile's tools are presented to clients.">
      <fieldset>
        <legend className="sr-only">Surface</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {SURFACES.map((s) => (
            <label
              key={s.value}
              className={cx(
                'flex cursor-pointer gap-2.5 rounded-md border px-3 py-2.5',
                draft.surface === s.value ? 'border-accent/60 bg-accent/5' : 'border-line hover:bg-subtle',
              )}
            >
              <input
                type="radio"
                name="surface"
                value={s.value}
                className="mt-0.5 accent-[var(--sb-accent)]"
                checked={draft.surface === s.value}
                onChange={() => set({ surface: s.value })}
              />
              <span>
                <span className="block text-sm font-medium">{s.title}</span>
                <span className="block text-xs text-muted">{s.body}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {draft.surface === 'auto' && (
        <div className="mt-4 max-w-xs">
          <NumberField
            label="Auto threshold"
            hint="Switch to meta-tools when the profile has more tools than this."
            min={0}
            value={draft.autoThreshold}
            onChange={(autoThreshold) => set({ autoThreshold })}
          />
        </div>
      )}
      {draft.surface === 'code' && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-medium">Sandbox budgets, per execute call</p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <NumberField
              label="Timeout (ms)"
              min={100}
              value={b.timeoutMs}
              onChange={(timeoutMs) => setBudget({ timeoutMs })}
            />
            <NumberField
              label="Max tool calls"
              min={1}
              value={b.maxToolCalls}
              onChange={(maxToolCalls) => setBudget({ maxToolCalls })}
            />
            <NumberField
              label="Memory (MB)"
              min={8}
              value={b.memoryMb}
              onChange={(memoryMb) => setBudget({ memoryMb })}
            />
            <NumberField
              label="Max source (bytes)"
              min={256}
              value={b.maxSourceBytes}
              onChange={(maxSourceBytes) => setBudget({ maxSourceBytes })}
            />
            <NumberField
              label="Max result (chars)"
              min={1000}
              value={b.maxResultChars}
              onChange={(maxResultChars) => setBudget({ maxResultChars })}
            />
          </div>
        </div>
      )}
    </Card>
  )
}

function PreviewPanel({
  preview,
  error,
  fetching,
}: {
  preview?: Preview
  error: unknown
  fetching: boolean
}) {
  const saving =
    preview && preview.tokens.passthrough > 0
      ? Math.round((1 - preview.tokens.listed / preview.tokens.passthrough) * 100)
      : 0
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          Live preview {fetching && <Spinner className="text-muted" />}
        </span>
      }
      description="What a client of this profile sees, including unsaved changes."
    >
      {error ? (
        <ErrorBox error={error} title="This draft is not valid" />
      ) : !preview ? (
        <p className="text-sm text-muted">Computing…</p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted">Surface</span>
            <Badge tone="accent">{preview.surface}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md bg-subtle px-3 py-2">
              <div className="text-[11px] text-muted">Tools allowed</div>
              <div className="text-lg font-semibold tabular-nums">{preview.tools.length}</div>
            </div>
            <div className="rounded-md bg-subtle px-3 py-2">
              <div className="text-[11px] text-muted">Tools listed</div>
              <div className="text-lg font-semibold tabular-nums">{preview.listed.length}</div>
            </div>
          </div>
          <div>
            <div className="flex justify-between text-xs">
              <span className="text-muted">Context, as listed</span>
              <span className="font-medium tabular-nums">
                ~{preview.tokens.listed.toLocaleString()} tokens
              </span>
            </div>
            <div className="mt-1 flex justify-between text-xs">
              <span className="text-muted">If passed through</span>
              <span className="tabular-nums">~{preview.tokens.passthrough.toLocaleString()} tokens</span>
            </div>
            {preview.tokens.passthrough > 0 && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-subtle" aria-hidden="true">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{
                    width: `${Math.min(100, (preview.tokens.listed / preview.tokens.passthrough) * 100)}%`,
                  }}
                />
              </div>
            )}
            {saving > 0 && <p className="mt-1 text-xs text-ok">{saving}% smaller than passthrough</p>}
          </div>
          {preview.missingServers.length > 0 && (
            <p className="rounded-md border border-warn/30 bg-warn/5 px-2.5 py-2 text-xs text-warn">
              No tool list yet for {preview.missingServers.join(', ')}. Test the server so its tools can be
              counted.
            </p>
          )}
          <div>
            <p className="mb-1.5 text-xs text-muted">Client sees</p>
            {preview.listed.length ? (
              <ul className="max-h-72 space-y-0.5 overflow-auto font-mono text-xs">
                {preview.listed.map((n) => (
                  <li key={n} className="truncate">
                    {n}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted">No tools. Check a server or include a tool.</p>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}
