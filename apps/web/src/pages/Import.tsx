import { slugSchema } from '@switchboard/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { DownloadIcon, PackageSearchIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ErrorAlert, InlineCode, LoadingState, Page } from '@/components/common'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { post } from '@/lib/api'
import { plural } from '@/lib/format'
import { keys, useClients, useImport } from '@/lib/queries'
import { Link, navigate } from '@/lib/router'
import type { ImportCandidate } from '@/lib/types'

const keyOf = (c: ImportCandidate) => `${c.client}/${c.originalName}`

function describe(c: ImportCandidate): string {
  const s = c.server as { command?: string; args?: string[]; url?: string }
  return s.command ? [s.command, ...(s.args ?? [])].join(' ') : (s.url ?? '')
}

export function ImportPage() {
  const candidates = useImport()
  const clients = useClients()
  const qc = useQueryClient()
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
      toast.success(`Imported ${plural(r.imported.length, 'server')}. Discovering their tools…`)
      void qc.invalidateQueries({ queryKey: keys.servers })
      void qc.invalidateQueries({ queryKey: keys.import })
      void qc.invalidateQueries({ queryKey: keys.config })
      navigate('/servers')
    },
  })

  const clientName = (id: string) => clients.data?.find((c) => c.id === id)?.name ?? id
  const hasCandidates = groups.length > 0

  return (
    <Page
      title="Import servers"
      description="MCP servers found in the configuration files of your AI clients. Importing copies them into Switchboard and starts them; the client files are not changed."
      footer={
        hasCandidates ? (
          <>
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {selected.length ? `${plural(selected.length, 'server')} selected` : 'Nothing selected'}
              {nameErrors.size > 0 && (
                <span className="text-destructive"> · fix {plural(nameErrors.size, 'name')}</span>
              )}
            </p>
            <Button
              disabled={!selected.length || nameErrors.size > 0 || run.isPending}
              onClick={() => run.mutate()}
            >
              {run.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <DownloadIcon data-icon="inline-start" />
              )}
              Import {selected.length || ''} selected
            </Button>
          </>
        ) : undefined
      }
    >
      {run.error && <ErrorAlert error={run.error} title="Import failed" />}
      {candidates.isPending ? (
        <LoadingState />
      ) : candidates.error ? (
        <ErrorAlert error={candidates.error} />
      ) : !hasCandidates ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PackageSearchIcon />
            </EmptyMedia>
            <EmptyTitle>Nothing to import</EmptyTitle>
            <EmptyDescription>
              No MCP servers were found in the config files of Cursor, Claude Code, Claude Desktop, VS Code
              and the other supported clients. Add one by hand instead.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row justify-center">
            <Button onClick={() => navigate('/servers/new')}>Add a server</Button>
            <Button variant="outline" onClick={() => navigate('/clients')}>
              See detected clients
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          {groups.map(([client, items]) => {
            const all = items.every(isPicked)
            return (
              <Card key={client} className="pb-0">
                <CardHeader className="border-b">
                  <CardTitle>{clientName(client)}</CardTitle>
                  <CardDescription>{plural(items.length, 'server')}</CardDescription>
                  <CardAction>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setPicked((p) => ({
                          ...p,
                          ...Object.fromEntries(items.map((c) => [keyOf(c), !all])),
                        }))
                      }
                    >
                      {all ? 'Select none' : 'Select all'}
                    </Button>
                  </CardAction>
                </CardHeader>
                <ul className="divide-y">
                  {items.map((c) => {
                    const k = keyOf(c)
                    const on = isPicked(c)
                    const err = on ? nameErrors.get(k) : undefined
                    const checkboxId = `imp-${k}`
                    return (
                      <li key={k} className="flex flex-wrap items-start gap-3 px-4 py-3">
                        <Checkbox
                          id={checkboxId}
                          className="mt-0.5"
                          checked={on}
                          onCheckedChange={(checked) => setPicked((p) => ({ ...p, [k]: checked === true }))}
                        />
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <label
                            htmlFor={checkboxId}
                            className="flex flex-wrap items-center gap-2 text-sm font-medium"
                          >
                            {c.originalName}
                            <Badge variant="outline">{c.server.transport}</Badge>
                            {c.exists && (
                              <Badge variant="secondary" title="Importing replaces the existing server">
                                exists
                              </Badge>
                            )}
                          </label>
                          <code
                            className="truncate font-mono text-xs text-muted-foreground"
                            title={describe(c)}
                          >
                            {describe(c)}
                          </code>
                        </div>
                        <Field
                          className="w-full sm:w-56"
                          data-invalid={!!err || undefined}
                          data-disabled={!on || undefined}
                        >
                          <FieldLabel htmlFor={`${checkboxId}-name`} className="sr-only">
                            Import {c.originalName} as
                          </FieldLabel>
                          <Input
                            id={`${checkboxId}-name`}
                            className="font-mono"
                            value={nameOf(c)}
                            aria-invalid={!!err || undefined}
                            disabled={!on}
                            onChange={(e) => setNames((n) => ({ ...n, [k]: e.target.value }))}
                          />
                          <FieldError>{err}</FieldError>
                          {!err && c.exists && on && nameOf(c) === c.name && (
                            <FieldDescription>Replaces the existing “{c.name}”.</FieldDescription>
                          )}
                        </Field>
                      </li>
                    )
                  })}
                </ul>
              </Card>
            )
          })}
          <p className="text-sm text-muted-foreground">
            Tokens in imported entries are copied as plain values. Move them to{' '}
            <Link to="/secrets" className="underline underline-offset-2 hover:text-foreground">
              Secrets
            </Link>{' '}
            afterwards and reference them as <InlineCode>secret://NAME</InlineCode>.
          </p>
        </>
      )}
    </Page>
  )
}
