import { brand, type ClientRule } from '@switchboard/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { enc, errorMessage, post, put } from '../lib/api.ts'
import { keys, useClients, useConfig, useStatus } from '../lib/queries.ts'
import { Link, navigate } from '../lib/router.tsx'
import type { ClientState } from '../lib/types.ts'
import {
  Badge,
  Button,
  Card,
  CodeBlock,
  cx,
  EmptyState,
  ErrorBox,
  Field,
  InlineCode,
  inputClass,
  Loading,
  monoInputClass,
  PageHeader,
  useToast,
} from '../lib/ui.tsx'
import { endpointUrl } from './Profiles.tsx'

export function ClientsPage() {
  const clients = useClients()
  const config = useConfig()
  const status = useStatus()
  const profiles = Object.keys(config.data?.profiles ?? {})
  const port = status.data?.port

  return (
    <>
      <PageHeader
        title="Clients"
        description="Switchboard can write its entry into each AI client's MCP config for you. A backup is made first, and only the entry it owns is changed."
      />
      {!profiles.length && config.data && (
        <div className="mb-5 rounded-md border border-warn/30 bg-warn/5 px-4 py-3 text-sm text-warn">
          Create a profile before connecting a client.{' '}
          <Link to="/profiles/new" className="font-medium underline">
            New profile →
          </Link>
        </div>
      )}

      {clients.isPending ? (
        <Loading label="Looking for clients" />
      ) : clients.error ? (
        <ErrorBox error={clients.error} />
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {[...clients.data]
            .sort((a, b) => Number(b.installed) - Number(a.installed))
            .map((c) => (
              <ClientCard key={c.id} client={c} profiles={profiles} port={port} />
            ))}
        </div>
      )}

      {config.data && (
        <div className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-2">
          <RulesCard rules={config.data.clientRules} profiles={profiles} />
          <DefaultProfileCard current={config.data.defaultProfile} profiles={profiles} />
        </div>
      )}

      <ManualSnippets profiles={profiles} port={port} />
    </>
  )
}

function ClientCard({
  client: c,
  profiles,
  port,
}: {
  client: ClientState
  profiles: string[]
  port?: number
}) {
  const [profile, setProfile] = useState(c.connectedProfile ?? profiles[0] ?? '')
  const qc = useQueryClient()
  const toast = useToast()
  const done = () => void qc.invalidateQueries({ queryKey: keys.clients })
  const connect = useMutation({
    mutationFn: () => post(`/clients/${enc(c.id)}/connect`, { profile }),
    onSuccess: () => {
      done()
      toast(`${c.name} now uses ${profile}. Restart or reload it to pick up the change.`, 'ok')
    },
  })
  const disconnect = useMutation({
    mutationFn: () => post(`/clients/${enc(c.id)}/disconnect`),
    onSuccess: () => {
      done()
      toast(`Removed ${brand.displayName} from ${c.name}`)
    },
  })
  const error = connect.error ?? disconnect.error
  const selectId = `client-${c.id}-profile`
  const same = c.connectedProfile === profile

  return (
    <div
      className={cx(
        'rounded-lg border bg-panel p-4 shadow-xs',
        c.installed ? 'border-line' : 'border-dashed border-line',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-semibold">{c.name}</h2>
            {c.connectedProfile ? (
              <Badge tone="ok">connected · {c.connectedProfile}</Badge>
            ) : c.installed ? (
              <Badge>not connected</Badge>
            ) : (
              <Badge>not detected</Badge>
            )}
            {c.foreignEntry && (
              <Badge
                tone="warn"
                title={`An entry named "${brand.name}" exists that Switchboard did not write`}
              >
                foreign entry
              </Badge>
            )}
          </div>
          <code className="mt-1 block font-mono text-[11px] break-all text-faint">{c.configPath}</code>
        </div>
        <a href={c.docs} target="_blank" rel="noreferrer" className="text-xs text-muted hover:text-fg">
          Docs ↗
        </a>
      </div>
      {c.serverCount > 0 && (
        <p className="mt-2 text-xs text-muted">
          {c.serverCount} other MCP server{c.serverCount === 1 ? '' : 's'} in this file.{' '}
          <Link to="/import" className="text-accent hover:underline">
            Import them
          </Link>
        </p>
      )}
      {c.error && <p className="mt-2 text-xs text-bad">{c.error}</p>}
      {c.foreignEntry && (
        <p className="mt-2 text-xs text-warn">
          The file already has a “{brand.name}” entry that Switchboard did not create. Connecting will not
          overwrite it; rename or remove it first.
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="min-w-40 flex-1">
          <label htmlFor={selectId} className="mb-1 block text-xs font-medium">
            Profile
          </label>
          <select
            id={selectId}
            className={inputClass}
            value={profile}
            disabled={!profiles.length}
            onChange={(e) => setProfile(e.target.value)}
          >
            {!profiles.length && <option value="">No profiles</option>}
            {profiles.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <Button
          variant="primary"
          disabled={!profile || same || c.foreignEntry}
          loading={connect.isPending}
          onClick={() => connect.mutate()}
        >
          {c.connectedProfile ? (same ? 'Connected' : 'Switch') : 'Connect'}
        </Button>
        {c.connectedProfile && (
          <Button variant="danger" loading={disconnect.isPending} onClick={() => disconnect.mutate()}>
            Disconnect
          </Button>
        )}
      </div>
      {!c.installed && (
        <p className="mt-2 text-xs text-muted">
          Not found on this machine. Connecting still writes the config file at the path above.
        </p>
      )}
      {error ? (
        <div className="mt-3">
          <ErrorBox error={error} />
        </div>
      ) : null}
      {profile && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-muted hover:text-fg">Manual setup</summary>
          <div className="mt-2">
            <CodeBlock label="URL" code={endpointUrl(port, profile)} />
          </div>
        </details>
      )}
    </div>
  )
}

function RulesCard({ rules, profiles }: { rules: ClientRule[]; profiles: string[] }) {
  const [draft, setDraft] = useState(rules)
  const [synced, setSynced] = useState(rules)
  // Reset the draft when the saved rules change elsewhere.
  if (JSON.stringify(synced) !== JSON.stringify(rules)) {
    setSynced(rules)
    setDraft(rules)
  }
  const qc = useQueryClient()
  const toast = useToast()
  const save = useMutation({
    mutationFn: () =>
      put<ClientRule[]>(
        '/client-rules',
        draft.filter((r) => r.client.trim()),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.config })
      toast('Client rules saved', 'ok')
    },
  })
  const dirty = JSON.stringify(draft) !== JSON.stringify(rules)
  const setRow = (i: number, patch: Partial<ClientRule>) =>
    setDraft((d) => d.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const move = (i: number, by: number) =>
    setDraft((d) => {
      const next = [...d]
      const [r] = next.splice(i, 1)
      next.splice(i + by, 0, r!)
      return next
    })

  return (
    <Card
      title="Client rules"
      description={
        <>
          For clients on the shared <InlineCode>/mcp</InlineCode> endpoint: match the MCP client name (glob,
          case insensitive) to a profile. The first match wins.
        </>
      }
    >
      {draft.length === 0 && (
        <p className="mb-3 text-sm text-muted">
          No rules. Add one such as <InlineCode>cursor*</InlineCode> → <InlineCode>work</InlineCode>.
        </p>
      )}
      <ol className="space-y-1.5">
        {draft.map((r, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rules are ordered rows without ids
          <li key={i} className="flex items-center gap-1.5">
            <span className="w-5 text-right text-xs text-faint tabular-nums">{i + 1}</span>
            <input
              aria-label={`Rule ${i + 1} client name pattern`}
              className={monoInputClass}
              value={r.client}
              placeholder="claude-code*"
              onChange={(e) => setRow(i, { client: e.target.value })}
            />
            <span className="text-faint" aria-hidden="true">
              →
            </span>
            <select
              aria-label={`Rule ${i + 1} profile`}
              className={`${inputClass} w-36 shrink-0`}
              value={r.profile}
              onChange={(e) => setRow(i, { profile: e.target.value })}
            >
              {!profiles.includes(r.profile) && <option value={r.profile}>{r.profile || 'choose…'}</option>}
              {profiles.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Move rule ${i + 1} up`}
              disabled={i === 0}
              onClick={() => move(i, -1)}
            >
              ↑
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Move rule ${i + 1} down`}
              disabled={i === draft.length - 1}
              onClick={() => move(i, 1)}
            >
              ↓
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Remove rule ${i + 1}`}
              onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}
            >
              ✕
            </Button>
          </li>
        ))}
      </ol>
      {save.error && (
        <div className="mt-3">
          <ErrorBox error={save.error} title="Could not save the rules" />
        </div>
      )}
      <div className="mt-3 flex justify-between gap-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={!profiles.length}
          onClick={() => setDraft((d) => [...d, { client: '', profile: profiles[0] ?? '' }])}
        >
          + Add rule
        </Button>
        <div className="flex gap-2">
          {dirty && (
            <Button size="sm" onClick={() => setDraft(rules)}>
              Discard
            </Button>
          )}
          <Button
            size="sm"
            variant="primary"
            disabled={!dirty}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            Save rules
          </Button>
        </div>
      </div>
    </Card>
  )
}

function DefaultProfileCard({ current, profiles }: { current?: string; profiles: string[] }) {
  const qc = useQueryClient()
  const toast = useToast()
  const save = useMutation({
    mutationFn: (profile: string | null) => put('/default-profile', { profile }),
    onSuccess: (_d, p) => {
      void qc.invalidateQueries({ queryKey: keys.config })
      toast(p ? `Default profile: ${p}` : 'Default profile cleared', 'ok')
    },
    onError: (e) => toast(errorMessage(e), 'bad'),
  })
  return (
    <Card
      title="Default profile"
      description={
        <>
          Used on <InlineCode>/mcp</InlineCode> when no URL path, header or client rule picks one. Without a
          default, such connections are refused.
        </>
      }
    >
      <Field label="Default profile">
        {(id) => (
          <select
            id={id}
            className={inputClass}
            value={current ?? ''}
            disabled={save.isPending}
            onChange={(e) => save.mutate(e.target.value || null)}
          >
            <option value="">None: refuse unmatched clients</option>
            {profiles.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        )}
      </Field>
      {save.error && (
        <div className="mt-3">
          <ErrorBox error={save.error} />
        </div>
      )}
    </Card>
  )
}

/** `x-switchboard-profile` → `X-Switchboard-Profile`, as people usually write it. */
const headerName = brand.profileHeader.replace(/(^|-)[a-z]/g, (c) => c.toUpperCase())

function ManualSnippets({ profiles, port }: { profiles: string[]; port?: number }) {
  const [profile, setProfile] = useState(profiles[0] ?? '')
  const p = profiles.includes(profile) ? profile : (profiles[0] ?? 'work')
  const base = `http://127.0.0.1:${port ?? brand.defaultPort}`
  const httpForm = JSON.stringify({ mcpServers: { [brand.name]: { url: endpointUrl(port, p) } } }, null, 2)
  const headerForm = JSON.stringify(
    { mcpServers: { [brand.name]: { url: `${base}/mcp`, headers: { [headerName]: p } } } },
    null,
    2,
  )
  const stdioForm = JSON.stringify(
    {
      mcpServers: {
        [brand.name]: { command: 'npx', args: ['-y', brand.packageName, 'connect', '--profile', p] },
      },
    },
    null,
    2,
  )
  return (
    <Card
      className="mt-8"
      title="Manual setup"
      description="For clients Switchboard does not know, or if you prefer to edit config files yourself."
      actions={
        profiles.length > 0 && (
          <select
            aria-label="Profile for snippets"
            className={`${inputClass} h-7 w-36 py-0.5 text-xs`}
            value={p}
            onChange={(e) => setProfile(e.target.value)}
          >
            {profiles.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        )
      }
    >
      {!profiles.length ? (
        <EmptyState
          title="No profiles yet"
          action={
            <Button size="sm" onClick={() => navigate('/profiles/new')}>
              Create a profile
            </Button>
          }
        >
          The snippets point at a profile's endpoint.
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div>
            <p className="mb-1.5 text-xs text-muted">Streamable HTTP, profile in the URL (recommended).</p>
            <CodeBlock label="HTTP URL" code={httpForm} />
          </div>
          <div>
            <p className="mb-1.5 text-xs text-muted">One shared URL, profile in a header.</p>
            <CodeBlock label="Header" code={headerForm} />
          </div>
          <div>
            <p className="mb-1.5 text-xs text-muted">For clients that only speak stdio.</p>
            <CodeBlock label="stdio bridge" code={stdioForm} />
          </div>
        </div>
      )}
    </Card>
  )
}
