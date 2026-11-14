import { slugSchema } from '@switchboard/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { post } from '../lib/api.ts'
import { keys, useClients, useImport } from '../lib/queries.ts'
import { Link, navigate } from '../lib/router.tsx'
import type { ImportCandidate } from '../lib/types.ts'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Loading,
  monoInputClass,
  PageHeader,
  useToast,
} from '../lib/ui.tsx'

const keyOf = (c: ImportCandidate) => `${c.client}/${c.originalName}`

function describe(c: ImportCandidate): string {
  const s = c.server as { command?: string; args?: string[]; url?: string }
  return s.command ? [s.command, ...(s.args ?? [])].join(' ') : (s.url ?? '')
}

export function ImportPage() {
  const candidates = useImport()
  const clients = useClients()
  const qc = useQueryClient()
  const toast = useToast()
  // Per candidate: selected and the name to import as. Defaults come from the API.
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [names, setNames] = useState<Record<string, string>>({})

  const groups = useMemo(() => {
    const map = new Map<string, ImportCandidate[]>()
    for (const c of candidates.data ?? []) map.set(c.client, [...(map.get(c.client) ?? []), c])
    return [...map.entries()]
  }, [candidates.data])

  const isPicked = (c: ImportCandidate) => picked[keyOf(c)] ?? !c.exists
  const nameOf = (c: ImportCandidate) => names[keyOf(c)] ?? c.name
  const selected = (candidates.data ?? []).filter(isPicked)
  const nameErrors = new Map<string, string>()
  const seen = new Map<string, string>()
  for (const c of selected) {
    const n = nameOf(c)
    const r = slugSchema.safeParse(n)
    if (!r.success) nameErrors.set(keyOf(c), r.error.issues[0]?.message ?? 'invalid name')
    else if (seen.has(n)) nameErrors.set(keyOf(c), `"${n}" is picked twice; rename one`)
    seen.set(n, keyOf(c))
  }

  const run = useMutation({
    mutationFn: () =>
      post<{ ok: true; imported: string[] }>('/import', {
        items: selected.map((c) => ({ name: nameOf(c), server: c.server })),
      }),
    onSuccess: (r) => {
      toast(`Imported ${r.imported.length} server${r.imported.length === 1 ? '' : 's'}`, 'ok')
      void qc.invalidateQueries({ queryKey: keys.servers })
      void qc.invalidateQueries({ queryKey: keys.import })
      void qc.invalidateQueries({ queryKey: keys.config })
      navigate('/servers')
    },
  })

  const clientName = (id: string) => clients.data?.find((c) => c.id === id)?.name ?? id

  return (
    <>
      <PageHeader
        title="Import servers"
        description="MCP servers found in the configuration files of your AI clients. Importing copies them into Switchboard; the client files are not changed."
        actions={
          <Button
            variant="primary"
            disabled={!selected.length || nameErrors.size > 0}
            loading={run.isPending}
            onClick={() => run.mutate()}
          >
            Import {selected.length || ''} selected
          </Button>
        }
      />
      {run.error && (
        <div className="mb-4">
          <ErrorBox error={run.error} title="Import failed" />
        </div>
      )}
      {candidates.isPending ? (
        <Loading label="Reading client configs" />
      ) : candidates.error ? (
        <ErrorBox error={candidates.error} />
      ) : !groups.length ? (
        <EmptyState
          title="Nothing to import"
          action={
            <>
              <Button variant="primary" onClick={() => navigate('/servers/new')}>
                Add a server
              </Button>
              <Button onClick={() => navigate('/clients')}>See detected clients</Button>
            </>
          }
        >
          No MCP servers were found in the config files of Cursor, Claude Code, Claude Desktop, VS Code and
          the other supported clients. Add one by hand instead.
        </EmptyState>
      ) : (
        <div className="space-y-4">
          {groups.map(([client, items]) => {
            const all = items.every(isPicked)
            return (
              <Card
                key={client}
                title={clientName(client)}
                description={`${items.length} server${items.length === 1 ? '' : 's'}`}
                actions={
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setPicked((p) => ({ ...p, ...Object.fromEntries(items.map((c) => [keyOf(c), !all])) }))
                    }
                  >
                    {all ? 'Select none' : 'Select all'}
                  </Button>
                }
                bodyClassName="divide-y divide-line"
              >
                {items.map((c) => {
                  const k = keyOf(c)
                  const err = isPicked(c) ? nameErrors.get(k) : undefined
                  const checkboxId = `imp-${k}`
                  return (
                    <div key={k} className="flex flex-wrap items-start gap-3 px-4 py-3">
                      <input
                        id={checkboxId}
                        type="checkbox"
                        className="mt-1.5 size-4 accent-[var(--sb-accent)]"
                        checked={isPicked(c)}
                        onChange={(e) => setPicked((p) => ({ ...p, [k]: e.target.checked }))}
                      />
                      <div className="min-w-0 flex-1">
                        <label
                          htmlFor={checkboxId}
                          className="flex flex-wrap items-center gap-2 text-sm font-medium"
                        >
                          {c.originalName}
                          <Badge>{c.server.transport}</Badge>
                          {c.exists && (
                            <Badge tone="warn" title="Importing replaces the existing server with this name">
                              exists
                            </Badge>
                          )}
                        </label>
                        <code
                          className="mt-0.5 block truncate font-mono text-xs text-muted"
                          title={describe(c)}
                        >
                          {describe(c)}
                        </code>
                      </div>
                      <div className="w-full sm:w-56">
                        <label className="sr-only" htmlFor={`${checkboxId}-name`}>
                          Import {c.originalName} as
                        </label>
                        <input
                          id={`${checkboxId}-name`}
                          className={monoInputClass}
                          value={nameOf(c)}
                          aria-invalid={!!err}
                          disabled={!isPicked(c)}
                          onChange={(e) => setNames((n) => ({ ...n, [k]: e.target.value }))}
                        />
                        {err && <p className="mt-1 text-xs text-bad">{err}</p>}
                        {!err && c.exists && isPicked(c) && nameOf(c) === c.name && (
                          <p className="mt-1 text-xs text-warn">Replaces the existing “{c.name}”.</p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </Card>
            )
          })}
          <p className="text-xs text-muted">
            Tokens in imported entries are copied as plain values. Move them to{' '}
            <Link to="/secrets" className="text-accent hover:underline">
              Secrets
            </Link>{' '}
            afterwards and reference them as <code className="font-mono">secret://NAME</code>.
          </p>
        </div>
      )}
    </>
  )
}
