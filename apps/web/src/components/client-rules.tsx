import type { ClientRule } from '@switchboard/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowDownIcon, ArrowUpIcon, CheckCircle2Icon, PlusIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ErrorAlert, InlineCode, SimpleSelect } from '@/components/common'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { put } from '@/lib/api'
import { keys } from '@/lib/queries'

const GLOB_RE = /^[A-Za-z0-9*?._@/ -]+$/

function ruleProblem(rule: ClientRule, index: number, rules: ClientRule[]): string | undefined {
  const glob = rule.client.trim()
  if (!glob) return 'Enter a client name pattern'
  if (!GLOB_RE.test(glob)) return 'Use letters, digits, spaces, * ? . _ - @ / only'
  if (rules.findIndex((r) => r.client.trim().toLowerCase() === glob.toLowerCase()) !== index)
    return 'Duplicate pattern; the first one already wins'
  if (!rule.profile) return 'Choose a profile'
  return undefined
}

export function RulesCard({ rules, profiles }: { rules: ClientRule[]; profiles: string[] }) {
  const [draft, setDraft] = useState(rules)
  const [synced, setSynced] = useState(rules)
  const [saved, setSaved] = useState(false)
  // Reset the draft when the saved rules change elsewhere.
  if (JSON.stringify(synced) !== JSON.stringify(rules)) {
    setSynced(rules)
    setDraft(rules)
  }
  const qc = useQueryClient()
  const save = useMutation({
    mutationFn: () =>
      put<ClientRule[]>(
        '/client-rules',
        draft.map((r) => ({ ...r, client: r.client.trim() })),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.config })
      setSaved(true)
      toast.success('Client rules saved')
    },
  })
  const dirty = JSON.stringify(draft) !== JSON.stringify(rules)
  const problems = draft.map((r, i) => ruleProblem(r, i, draft))
  const invalid = problems.some(Boolean)
  const edit = (fn: (d: ClientRule[]) => ClientRule[]) => {
    setSaved(false)
    setDraft(fn)
  }
  const setRow = (i: number, patch: Partial<ClientRule>) =>
    edit((d) => d.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const move = (i: number, by: number) =>
    edit((d) => {
      const next = [...d]
      const [r] = next.splice(i, 1)
      next.splice(i + by, 0, r!)
      return next
    })

  return (
    <Card id="rules" className="scroll-mt-20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Client rules
          {dirty ? (
            <Badge variant="secondary">Unsaved changes</Badge>
          ) : saved ? (
            <Badge variant="outline">
              <CheckCircle2Icon data-icon="inline-start" />
              Saved
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription>
          For clients that have no profile switched on above: the client's MCP name is matched against each
          pattern (glob, case-insensitive) and the first match picks the profile. Saved in config.json.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {draft.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No rules. Add one such as <InlineCode>cursor*</InlineCode> → <InlineCode>work</InlineCode>.
          </p>
        ) : (
          <ol className="flex flex-col gap-3">
            {draft.map((r, i) => {
              const problem = problems[i]
              const inputId = `rule-${i}-client`
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: rules are ordered rows without ids
                <li key={i}>
                  <Field data-invalid={!!problem || undefined}>
                    <FieldLabel htmlFor={inputId} className="sr-only">
                      Rule {i + 1} client name pattern
                    </FieldLabel>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="w-5 text-right text-xs text-muted-foreground tabular-nums">
                        {i + 1}
                      </span>
                      <Input
                        id={inputId}
                        aria-invalid={!!problem || undefined}
                        className="min-w-32 flex-1 font-mono"
                        value={r.client}
                        placeholder="claude-code*"
                        onChange={(e) => setRow(i, { client: e.target.value })}
                      />
                      <span className="text-muted-foreground" aria-hidden="true">
                        →
                      </span>
                      <SimpleSelect
                        aria-label={`Rule ${i + 1} profile`}
                        className="w-36"
                        value={r.profile}
                        placeholder="Choose…"
                        onValueChange={(profile) => setRow(i, { profile })}
                        options={[
                          ...(r.profile && !profiles.includes(r.profile)
                            ? [{ value: r.profile, label: `${r.profile} (missing)` }]
                            : []),
                          ...profiles.map((p) => ({ value: p, label: p })),
                        ]}
                      />
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Move rule ${i + 1} up`}
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                      >
                        <ArrowUpIcon />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Move rule ${i + 1} down`}
                        disabled={i === draft.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        <ArrowDownIcon />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Remove rule ${i + 1}`}
                        onClick={() => edit((d) => d.filter((_, j) => j !== i))}
                      >
                        <XIcon />
                      </Button>
                    </div>
                    {problem && <FieldError className="pl-6">{problem}</FieldError>}
                  </Field>
                </li>
              )
            })}
          </ol>
        )}
        {save.error ? <ErrorAlert error={save.error} title="Could not save the rules" /> : null}
      </CardContent>
      <CardFooter className="justify-between gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!profiles.length}
          onClick={() => edit((d) => [...d, { client: '', profile: profiles[0] ?? '' }])}
        >
          <PlusIcon data-icon="inline-start" />
          Add rule
        </Button>
        <div className="flex gap-2">
          {dirty && (
            <Button size="sm" variant="ghost" onClick={() => edit(() => rules)}>
              Discard
            </Button>
          )}
          <Button size="sm" disabled={!dirty || invalid || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Spinner data-icon="inline-start" />}
            Save rules
          </Button>
        </div>
      </CardFooter>
    </Card>
  )
}
