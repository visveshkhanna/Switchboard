import { type Profile, profileSchema, type Surface, slugSchema } from '@switchboard/shared'
import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { LayersIcon, PlusIcon, ServerIcon, XIcon } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ConfirmButton, ErrorAlert, InlineCode, LoadingState, Page, UrlField } from '@/components/common'
import { CredentialsCard } from '@/components/profile-credentials'
import { ServerState } from '@/components/server-status'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
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
  FieldLegend,
  FieldSet,
  FieldTitle,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { del, enc, errorMessage, get, post, put } from '@/lib/api'
import { candidateServers, PATTERN_RE, setTool, toolState } from '@/lib/profileTools'
import { keys, useClients, useConfig, useServers, useStatus } from '@/lib/queries'
import { Link, navigate } from '@/lib/router'
import { baseUrl, profileUrl } from '@/lib/snippets'
import type { Preview, ToolDef } from '@/lib/types'
import { cn } from '@/lib/utils'

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
  const newButton = (
    <Button onClick={() => navigate('/profiles/new')}>
      <PlusIcon data-icon="inline-start" />
      New profile
    </Button>
  )
  return (
    <Page
      title="Profiles"
      description="A profile is a set of servers and tools. Each client uses one profile, switched on the Clients page; clients nothing else matches use the default profile."
      actions={newButton}
    >
      {config.isPending ? (
        <LoadingState />
      ) : config.error ? (
        <ErrorAlert error={config.error} />
      ) : !Object.keys(config.data.profiles).length ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LayersIcon />
            </EmptyMedia>
            <EmptyTitle>No profiles yet</EmptyTitle>
            <EmptyDescription>
              {Object.keys(config.data.servers).length
                ? 'Create one, such as "personal" or "work", and pick the servers it includes.'
                : 'Add or import a few servers first, then group them into a profile.'}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>{newButton}</EmptyContent>
        </Empty>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {Object.entries(config.data.profiles).map(([name, p]) => (
            <Card key={name}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  <Link to={`/profiles/${name}`} className="hover:underline">
                    {name}
                  </Link>
                  {config.data.defaultProfile === name && <Badge variant="secondary">Default</Badge>}
                </CardTitle>
                <CardDescription>{p.description || 'No description'}</CardDescription>
                <CardAction>
                  <Badge variant="outline">{p.surface}</Badge>
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">
                  {p.servers.length ? p.servers.join(', ') : 'No servers'}
                  {p.include.length > 0 && ` · +${p.include.length} included`}
                  {p.exclude.length > 0 && ` · −${p.exclude.length} excluded`}
                </p>
                <ProfileUsage name={name} />
              </CardContent>
              <CardFooter className="justify-end gap-2">
                {config.data.defaultProfile !== name && <MakeDefaultButton name={name} />}
                <Button
                  size="sm"
                  variant="outline"
                  render={<Link to={`/profiles/${name}`} />}
                  nativeButton={false}
                >
                  Edit
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </Page>
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
  if (config.isPending || config.error)
    return (
      <Page title={name ?? 'New profile'} parent={{ label: 'Profiles', to: '/profiles' }}>
        {config.error ? <ErrorAlert error={config.error} /> : <LoadingState />}
      </Page>
    )
  const saved = name ? config.data.profiles[name] : undefined
  if (name && !saved)
    return (
      <Page title={name} parent={{ label: 'Profiles', to: '/profiles' }}>
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>No profile named “{name}”</EmptyTitle>
            <EmptyDescription>It may have been deleted.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={() => navigate('/profiles')}>
              All profiles
            </Button>
          </EmptyContent>
        </Empty>
      </Page>
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
  const config = useConfig()
  const servers = useServers()
  const qc = useQueryClient()
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
      toast.success(`Saved ${profileName}`)
      if (isNew) navigate(`/profiles/${profileName}`, { replace: true })
    },
  })
  const submit = () => {
    setTouched(true)
    if (isNew && !nameCheck.success) return
    save.mutate()
  }

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
  const url = profileUrl(baseUrl(status.data), profileName || '<name>')

  return (
    <Page
      parent={{ label: 'Profiles', to: '/profiles' }}
      title={isNew ? 'New profile' : name}
      description={
        isNew
          ? 'Choose servers and tools, then create the profile to get its URL.'
          : saved.description || undefined
      }
      actions={
        !isNew && (
          <>
            {config.data?.defaultProfile === name ? (
              <Badge variant="secondary">Default</Badge>
            ) : (
              <MakeDefaultButton name={name} />
            )}
            <ConfirmButton
              title={`Delete profile “${name}”?`}
              description="Clients using its URL stop working, and client rules pointing at it are removed. Servers are kept."
              onConfirm={async () => {
                await del(`/profiles/${enc(name)}`)
                void qc.invalidateQueries({ queryKey: keys.config })
                toast(`Deleted ${name}`)
                navigate('/profiles')
              }}
            >
              Delete
            </ConfirmButton>
          </>
        )
      }
      footer={
        <>
          <span className="text-sm text-muted-foreground" aria-live="polite">
            {isNew ? (
              'Not created yet'
            ) : dirty ? (
              <Badge variant="secondary">Unsaved changes</Badge>
            ) : (
              'All changes saved'
            )}
          </span>
          <div className="flex items-center gap-2">
            {!isNew && dirty && (
              <Button variant="outline" onClick={() => setDraft(saved)}>
                Discard
              </Button>
            )}
            <Button disabled={!dirty || save.isPending} onClick={submit}>
              {save.isPending && <Spinner data-icon="inline-start" />}
              {isNew ? 'Create profile' : 'Save'}
            </Button>
          </div>
        </>
      }
    >
      {save.error ? <ErrorAlert error={save.error} title="Could not save the profile" /> : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>General</CardTitle>
            </CardHeader>
            <CardContent>
              <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {isNew && (
                  <Field data-invalid={!!nameError || undefined}>
                    <FieldLabel htmlFor="profile-name">Name</FieldLabel>
                    <Input
                      id="profile-name"
                      aria-invalid={!!nameError || undefined}
                      className="font-mono"
                      value={newName}
                      placeholder="work"
                      autoComplete="off"
                      onChange={(e) => setNewName(e.target.value)}
                    />
                    {nameError ? (
                      <FieldError>{nameError}</FieldError>
                    ) : (
                      <FieldDescription>Lowercase, used in the URL.</FieldDescription>
                    )}
                  </Field>
                )}
                <Field className={cn(!isNew && 'md:col-span-2')}>
                  <FieldLabel htmlFor="profile-description">Description</FieldLabel>
                  <Input
                    id="profile-description"
                    value={draft.description ?? ''}
                    placeholder="Tools for client work"
                    onChange={(e) => set({ description: e.target.value || undefined })}
                  />
                </Field>
                <Field className="md:col-span-2">
                  <FieldLabel htmlFor="profile-url">Pinned URL (advanced)</FieldLabel>
                  {isNew ? (
                    <Input id="profile-url" readOnly value={url} className="font-mono text-xs" />
                  ) : (
                    <UrlField url={url} label="Profile URL" />
                  )}
                  <FieldDescription>
                    {isNew ? 'Available once the profile is created. ' : ''}
                    Always serves this profile. Usually you switch a client's profile on the{' '}
                    <Link to="/clients">Clients</Link> page instead.
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Servers</CardTitle>
              <CardDescription>
                Every tool of a checked server is included, minus exclusions below.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!serverNames.length ? (
                <Empty className="border">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <ServerIcon />
                    </EmptyMedia>
                    <EmptyTitle>No servers to choose from</EmptyTitle>
                    <EmptyDescription>Add or import servers first.</EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button variant="outline" size="sm" onClick={() => navigate('/import')}>
                      Import servers
                    </Button>
                  </EmptyContent>
                </Empty>
              ) : (
                <FieldSet>
                  <FieldLegend className="sr-only">Servers in this profile</FieldLegend>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {serverNames.map((s) => {
                      const row = servers.data?.find((r) => r.name === s)
                      const id = `server-${s}`
                      return (
                        <FieldLabel key={s} htmlFor={id}>
                          <Field orientation="horizontal">
                            <Checkbox
                              id={id}
                              checked={draft.servers.includes(s)}
                              onCheckedChange={(checked) =>
                                set({
                                  servers: checked
                                    ? [...draft.servers, s]
                                    : draft.servers.filter((x) => x !== s),
                                })
                              }
                            />
                            <FieldContent className="min-w-0">
                              <FieldTitle className="truncate">{s}</FieldTitle>
                              {row && <ServerState status={row.status} enabled={row.config.enabled} />}
                            </FieldContent>
                          </Field>
                        </FieldLabel>
                      )
                    })}
                  </div>
                </FieldSet>
              )}
            </CardContent>
          </Card>

          <CredentialsCard profileName={profileName || 'new-profile'} draft={draft} set={set} />

          <ToolsCard
            draft={draft}
            setDraft={setDraft}
            candidates={candidates}
            tools={Object.fromEntries(candidates.map((s, i) => [s, toolQueries[i]]))}
            exposed={exposed}
          />

          <Card>
            <CardHeader>
              <CardTitle>Patterns</CardTitle>
              <CardDescription>
                <InlineCode>server.tool</InlineCode>, <InlineCode>server.*</InlineCode> or globs like{' '}
                <InlineCode>git*.list_*</InlineCode>. Exclusions are applied last and always win.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <PatternList
                  id="include"
                  label="Include"
                  hint="Extra tools from servers not checked above."
                  values={draft.include}
                  onChange={(include) => set({ include })}
                />
                <PatternList
                  id="exclude"
                  label="Exclude"
                  hint="Tools removed from this profile."
                  values={draft.exclude}
                  onChange={(exclude) => set({ exclude })}
                />
              </div>
            </CardContent>
          </Card>

          <SurfaceCard draft={draft} set={set} />
        </div>

        <aside className="lg:sticky lg:top-20 lg:max-h-[calc(100svh-9rem)] lg:self-start lg:overflow-y-auto">
          <PreviewPanel preview={preview.data} error={preview.error} fetching={preview.isFetching} />
        </aside>
      </div>
    </Page>
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
    <Card>
      <CardHeader>
        <CardTitle>Tools</CardTitle>
        <CardDescription>
          Switch single tools on or off; this edits the include and exclude lists for you.
        </CardDescription>
        {candidates.length > 0 && (
          <CardAction>
            <Input
              aria-label="Filter tools"
              placeholder="Filter…"
              className="h-7 w-40"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!candidates.length && (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Check a server above to see its tools.
          </p>
        )}
        {candidates.map((server) => {
          const q = tools[server]
          const list = (q?.data ?? []).filter(
            (t) => !f || t.name.toLowerCase().includes(f) || t.description?.toLowerCase().includes(f),
          )
          const on = (q?.data ?? []).filter((t) => toolState(draft, server, t.name).active).length
          return (
            <section
              key={server}
              aria-label={`${server} tools`}
              className="overflow-hidden rounded-lg border"
            >
              <div className="flex items-center justify-between bg-muted/50 px-3 py-1.5">
                <span className="text-xs font-semibold">{server}</span>
                <span className="text-xs text-muted-foreground">
                  {q?.data ? `${on} of ${q.data.length} on` : ''}
                </span>
              </div>
              {q?.isPending ? (
                <p className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
                  <Spinner /> Loading tools…
                </p>
              ) : !q?.data?.length ? (
                <p className="px-3 py-3 text-xs text-muted-foreground">
                  No tools yet. They are discovered when the server starts;{' '}
                  <Link to={`/servers/${server}`} className="underline underline-offset-4">
                    open {server}
                  </Link>{' '}
                  to check it.
                </p>
              ) : (
                <ul className="divide-y">
                  {list.map((t) => {
                    const id = `${server}.${t.name}`
                    const st = toolState(draft, server, t.name)
                    const override = draft.overrides[id]
                    const blocked = !st.active && st.blockedBy.length > 0
                    return (
                      <li key={id} className="px-3 py-2">
                        <div className="flex items-start gap-3">
                          <Switch
                            size="sm"
                            className="mt-1"
                            checked={st.active}
                            disabled={blocked}
                            aria-label={
                              blocked ? `${id} is excluded by ${st.blockedBy.join(', ')}` : `Include ${id}`
                            }
                            onCheckedChange={(next) => setDraft((p) => setTool(p, server, t.name, next))}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                              <code
                                className={cn('font-mono text-sm', !st.active && 'text-muted-foreground')}
                              >
                                {t.name}
                              </code>
                              {st.active && exposed.get(id) && (
                                <span className="font-mono text-xs text-muted-foreground">
                                  as {exposed.get(id)}
                                </span>
                              )}
                              {override && (override.name || override.description) && (
                                <Badge variant="secondary">edited</Badge>
                              )}
                              {blocked && (
                                <Badge variant="outline">excluded by {st.blockedBy.join(', ')}</Badge>
                              )}
                            </div>
                            {t.description && (
                              <p className="line-clamp-1 text-xs text-muted-foreground" title={t.description}>
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
                          <FieldGroup className="mt-2 grid grid-cols-1 gap-3 rounded-lg bg-muted/50 p-3 md:grid-cols-2">
                            <Field>
                              <FieldLabel htmlFor={`${id}-name`}>Name shown to clients</FieldLabel>
                              <Input
                                id={`${id}-name`}
                                className="font-mono"
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
                              <FieldDescription>
                                Default: {exposed.get(id) ?? `${server}__${t.name}`}
                              </FieldDescription>
                            </Field>
                            <Field>
                              <FieldLabel htmlFor={`${id}-description`}>Description</FieldLabel>
                              <Textarea
                                id={`${id}-description`}
                                rows={2}
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
                              <FieldDescription>Leave empty to keep the server's.</FieldDescription>
                            </Field>
                          </FieldGroup>
                        )}
                      </li>
                    )
                  })}
                  {!list.length && (
                    <li className="px-3 py-2 text-xs text-muted-foreground">No tools match “{filter}”.</li>
                  )}
                </ul>
              )}
            </section>
          )
        })}
      </CardContent>
    </Card>
  )
}

function PatternList({
  id,
  label,
  hint,
  values,
  onChange,
}: {
  id: string
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
    <Field data-invalid={!!error || undefined}>
      <FieldLabel htmlFor={`pattern-${id}`}>{label}</FieldLabel>
      <div className="flex gap-2">
        <Input
          id={`pattern-${id}`}
          aria-invalid={!!error || undefined}
          className="font-mono"
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
        <Button variant="outline" onClick={add}>
          Add
        </Button>
      </div>
      {error ? <FieldError>{error}</FieldError> : <FieldDescription>{hint}</FieldDescription>}
      {values.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {values.map((v) => (
            <li key={v}>
              <Badge variant="secondary" className="font-mono">
                {v}
                <button
                  type="button"
                  aria-label={`Remove ${v}`}
                  className="rounded-sm hover:text-foreground"
                  onClick={() => onChange(values.filter((x) => x !== v))}
                >
                  <XIcon />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </Field>
  )
}

function NumberField({
  id,
  label,
  hint,
  value,
  onChange,
  min,
}: {
  id: string
  label: string
  hint?: ReactNode
  value: number
  onChange: (n: number) => void
  min?: number
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="number"
        min={min}
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => onChange(e.target.value === '' ? Number.NaN : Number(e.target.value))}
      />
      {hint && <FieldDescription>{hint}</FieldDescription>}
    </Field>
  )
}

function SurfaceCard({ draft, set }: { draft: Profile; set: (p: Partial<Profile>) => void }) {
  const b = draft.budgets
  const setBudget = (patch: Partial<Profile['budgets']>) => set({ budgets: { ...b, ...patch } })
  return (
    <Card>
      <CardHeader>
        <CardTitle>Tool surface</CardTitle>
        <CardDescription>How this profile's tools are presented to clients.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <FieldSet>
          <FieldLegend className="sr-only">Surface</FieldLegend>
          <RadioGroup
            value={draft.surface}
            onValueChange={(v) => set({ surface: v as Surface })}
            className="grid grid-cols-1 gap-2 sm:grid-cols-2"
          >
            {SURFACES.map((s) => (
              <FieldLabel key={s.value} htmlFor={`surface-${s.value}`}>
                <Field orientation="horizontal">
                  <RadioGroupItem id={`surface-${s.value}`} value={s.value} />
                  <FieldContent>
                    <FieldTitle>{s.title}</FieldTitle>
                    <FieldDescription>{s.body}</FieldDescription>
                  </FieldContent>
                </Field>
              </FieldLabel>
            ))}
          </RadioGroup>
        </FieldSet>
        {draft.surface === 'auto' && (
          <div className="max-w-xs">
            <NumberField
              id="auto-threshold"
              label="Auto threshold"
              hint="Switch to meta-tools when the profile has more tools than this."
              min={0}
              value={draft.autoThreshold}
              onChange={(autoThreshold) => set({ autoThreshold })}
            />
          </div>
        )}
        {draft.surface === 'code' && (
          <FieldSet>
            <FieldLegend variant="label">Sandbox budgets, per execute call</FieldLegend>
            <FieldGroup className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <NumberField
                id="budget-timeout"
                label="Timeout (ms)"
                min={100}
                value={b.timeoutMs}
                onChange={(timeoutMs) => setBudget({ timeoutMs })}
              />
              <NumberField
                id="budget-calls"
                label="Max tool calls"
                min={1}
                value={b.maxToolCalls}
                onChange={(maxToolCalls) => setBudget({ maxToolCalls })}
              />
              <NumberField
                id="budget-memory"
                label="Memory (MB)"
                min={8}
                value={b.memoryMb}
                onChange={(memoryMb) => setBudget({ memoryMb })}
              />
              <NumberField
                id="budget-source"
                label="Max source (bytes)"
                min={256}
                value={b.maxSourceBytes}
                onChange={(maxSourceBytes) => setBudget({ maxSourceBytes })}
              />
              <NumberField
                id="budget-result"
                label="Max result (chars)"
                min={1000}
                value={b.maxResultChars}
                onChange={(maxResultChars) => setBudget({ maxResultChars })}
              />
            </FieldGroup>
          </FieldSet>
        )}
      </CardContent>
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
  const ratio =
    preview && preview.tokens.passthrough > 0
      ? Math.min(100, (preview.tokens.listed / preview.tokens.passthrough) * 100)
      : 0
  const saving = preview && preview.tokens.passthrough > 0 ? Math.round(100 - ratio) : 0
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Live preview {fetching && <Spinner className="text-muted-foreground" />}
        </CardTitle>
        <CardDescription>What a client of this profile sees, including unsaved changes.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error ? (
          <ErrorAlert error={error} title="This draft is not valid" />
        ) : !preview ? (
          <p className="text-sm text-muted-foreground">Computing…</p>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Surface</span>
              <Badge>{preview.surface}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-muted/50 px-3 py-2">
                <div className="text-xs text-muted-foreground">Tools allowed</div>
                <div className="text-lg font-semibold">{preview.tools.length}</div>
              </div>
              <div className="rounded-lg bg-muted/50 px-3 py-2">
                <div className="text-xs text-muted-foreground">Tools listed</div>
                <div className="text-lg font-semibold">{preview.listed.length}</div>
              </div>
            </div>
            <div className="flex flex-col gap-1 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Context, as listed</span>
                <span className="font-medium tabular-nums">
                  ~{preview.tokens.listed.toLocaleString()} tokens
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">If passed through</span>
                <span className="tabular-nums">~{preview.tokens.passthrough.toLocaleString()} tokens</span>
              </div>
              {preview.tokens.passthrough > 0 && (
                <Progress
                  value={ratio}
                  aria-label="Listed context compared with passthrough"
                  className="mt-1"
                />
              )}
              {saving > 0 && <p className="text-muted-foreground">{saving}% smaller than passthrough</p>}
            </div>
            {preview.missingServers.length > 0 && (
              <Alert>
                <AlertDescription>
                  No tool list yet for {preview.missingServers.join(', ')}. Its tools are counted once the
                  server has started.
                </AlertDescription>
              </Alert>
            )}
            <Separator />
            <div className="flex flex-col gap-1.5">
              <p className="text-xs text-muted-foreground">Client sees</p>
              {preview.listed.length ? (
                <ul className="flex flex-col gap-0.5 font-mono text-xs">
                  {preview.listed.map((n) => (
                    <li key={n} className="truncate">
                      {n}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">No tools. Check a server or include a tool.</p>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

/** Make a profile the default for clients nothing else matches. */
function MakeDefaultButton({ name }: { name: string }) {
  const qc = useQueryClient()
  const save = useMutation({
    mutationFn: () => put('/default-profile', { profile: name }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.config })
      void qc.invalidateQueries({ queryKey: keys.clients })
      toast.success(`${name} is now the default profile`)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Button size="sm" variant="outline" disabled={save.isPending} onClick={() => save.mutate()}>
      {save.isPending && <Spinner data-icon="inline-start" />}
      Make default
    </Button>
  )
}

/** How many clients use a profile right now. */
function ProfileUsage({ name }: { name: string }) {
  const clients = useClients()
  const using = (clients.data ?? []).filter((c) => c.selection !== 'off' && c.effectiveProfile === name)
  if (!clients.data) return null
  return (
    <p className="text-sm text-muted-foreground">
      {using.length
        ? `Used by ${using.map((c) => c.name).join(', ')}`
        : 'No client uses it yet. Switch it on for a client on the Clients page.'}
    </p>
  )
}
