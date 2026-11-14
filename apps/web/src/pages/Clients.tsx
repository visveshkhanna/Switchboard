import { brand, type ClientRule } from '@switchboard/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ExternalLinkIcon,
  InfoIcon,
  PlusIcon,
  TriangleAlertIcon,
  XIcon,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  ErrorAlert,
  InlineCode,
  LoadingState,
  Page,
  SimpleSelect,
  Snippet,
  UrlField,
} from '@/components/common'
import { AUTO } from '@/components/SetupWithAI'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { enc, errorMessage, post, put } from '@/lib/api'
import { keys, useClients, useConfig, useStatus } from '@/lib/queries'
import { Link } from '@/lib/router'
import { clientInfo, configSnippet, sharedUrl } from '@/lib/snippets'
import type { ClientState } from '@/lib/types'

export function ClientsPage() {
  const clients = useClients()
  const config = useConfig()
  const status = useStatus()
  const profiles = Object.keys(config.data?.profiles ?? {})
  const port = status.data?.port

  return (
    <Page
      title="Clients"
      description="Point your AI clients at Switchboard. Each client gets one entry; Switchboard decides which tools it sees."
    >
      <Alert>
        <InfoIcon />
        <AlertTitle>How connecting works</AlertTitle>
        <AlertDescription>
          Connect writes one entry named <InlineCode>{brand.name}</InlineCode> into the client's MCP config
          file, pointing at the profile you pick. A backup of the file is made first and no other entries are
          touched. Restart the client afterwards.
        </AlertDescription>
      </Alert>

      {!profiles.length && config.data && (
        <Alert>
          <TriangleAlertIcon />
          <AlertTitle>No profiles yet</AlertTitle>
          <AlertDescription>
            You can still connect in automatic mode, but the shared URL refuses clients until a profile
            exists. <Link to="/profiles/new">Create a profile</Link>.
          </AlertDescription>
        </Alert>
      )}

      {clients.isPending ? (
        <LoadingState rows={4} />
      ) : clients.error ? (
        <ErrorAlert error={clients.error} />
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {[...clients.data]
            .sort((a, b) => Number(b.installed) - Number(a.installed))
            .map((c) => (
              <ClientCard key={c.id} client={c} profiles={profiles} port={port} />
            ))}
        </div>
      )}

      {config.data && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <RulesCard rules={config.data.clientRules} profiles={profiles} port={port} />
          <DefaultProfileCard current={config.data.defaultProfile} profiles={profiles} />
        </div>
      )}
    </Page>
  )
}

function isConnected(c: ClientState): boolean {
  return Boolean(c.connectedProfile) || c.connectedMode === 'auto'
}

/** The select value matching what the client is connected to now. */
function currentChoice(c: ClientState): string | undefined {
  if (c.connectedMode === 'auto') return AUTO
  return c.connectedProfile
}

function StateBadge({ client: c }: { client: ClientState }) {
  if (c.connectedMode === 'auto') return <Badge>Connected · automatic</Badge>
  if (c.connectedProfile) return <Badge>Connected · {c.connectedProfile}</Badge>
  if (c.installed) return <Badge variant="secondary">Not connected</Badge>
  return <Badge variant="outline">Not installed</Badge>
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
  const [choice, setChoice] = useState(currentChoice(c) ?? profiles[0] ?? AUTO)
  const [restartNote, setRestartNote] = useState(false)
  const qc = useQueryClient()
  const done = () => void qc.invalidateQueries({ queryKey: keys.clients })
  const profile = choice === AUTO ? null : choice
  const connect = useMutation({
    mutationFn: () => post(`/clients/${enc(c.id)}/connect`, { profile }),
    onSuccess: () => {
      done()
      setRestartNote(true)
      toast.success(
        profile ? `${c.name} now uses ${profile}` : `${c.name} now uses the shared URL (automatic profile)`,
      )
    },
  })
  const disconnect = useMutation({
    mutationFn: () => post(`/clients/${enc(c.id)}/disconnect`),
    onSuccess: () => {
      done()
      setRestartNote(true)
      toast(`Removed ${brand.displayName} from ${c.name}`)
    },
  })
  const error = connect.error ?? disconnect.error
  const selectId = `client-${c.id}-profile`
  const connected = isConnected(c)
  const same = connected && currentChoice(c) === choice
  const info = clientInfo(c.id)

  return (
    <Card className={c.installed ? undefined : 'opacity-90'}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {c.name}
          <StateBadge client={c} />
          {c.foreignEntry && <Badge variant="destructive">Foreign entry</Badge>}
        </CardTitle>
        <CardDescription className="font-mono text-xs break-all">{c.configPath}</CardDescription>
        <CardAction>
          <Button
            size="sm"
            variant="ghost"
            render={<a href={c.docs} target="_blank" rel="noreferrer" />}
            nativeButton={false}
          >
            Docs
            <ExternalLinkIcon data-icon="inline-end" />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!c.installed && (
          <p className="text-sm text-muted-foreground">
            Not found on this machine. Connecting still writes the config file at the path above.
          </p>
        )}
        {c.serverCount > 0 && (
          <p className="text-sm text-muted-foreground">
            {c.serverCount} other MCP server{c.serverCount === 1 ? '' : 's'} in this file.{' '}
            <Link to="/import" className="text-foreground underline underline-offset-4">
              Import them
            </Link>{' '}
            to share them through {brand.displayName}.
          </p>
        )}
        {c.error && <p className="text-sm text-destructive">{c.error}</p>}
        {c.foreignEntry && (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertDescription>
              The file already has a “{brand.name}” entry that {brand.displayName} did not create. Connecting
              will not overwrite it; rename or remove it first.
            </AlertDescription>
          </Alert>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <Field className="min-w-48 flex-1">
            <FieldLabel htmlFor={selectId}>Profile</FieldLabel>
            <SimpleSelect
              id={selectId}
              value={choice}
              onValueChange={(v) => {
                setChoice(v)
                setRestartNote(false)
              }}
              options={[
                { value: AUTO, label: 'Automatic (client rules / default)' },
                ...profiles.map((p) => ({ value: p, label: p })),
              ]}
            />
          </Field>
          <Button disabled={same || c.foreignEntry || connect.isPending} onClick={() => connect.mutate()}>
            {connect.isPending && <Spinner data-icon="inline-start" />}
            {connected ? (same ? 'Connected' : 'Switch') : 'Connect'}
          </Button>
          {connected && (
            <Button variant="outline" disabled={disconnect.isPending} onClick={() => disconnect.mutate()}>
              {disconnect.isPending && <Spinner data-icon="inline-start" />}
              Disconnect
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {profile
            ? `Points at /p/${profile}/mcp: this client always sees the "${profile}" profile.`
            : 'Points at the shared /mcp URL: client rules, then the default profile, choose the profile.'}
        </p>
        {restartNote && !error && (
          <Alert>
            <CheckCircle2Icon />
            <AlertTitle>Restart {c.name} to pick it up</AlertTitle>
            <AlertDescription>The config file changed; the client reads it on start.</AlertDescription>
          </Alert>
        )}
        {error ? <ErrorAlert error={error} /> : null}
      </CardContent>
      <CardFooter className="flex-col items-stretch">
        <Collapsible>
          <CollapsibleTrigger
            render={<Button variant="ghost" size="sm" className="group/what -ml-2 w-fit" />}
          >
            What will be written
            <ChevronDownIcon
              data-icon="inline-end"
              className="transition-transform group-data-[panel-open]/what:rotate-180"
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-2 pt-2">
            <p className="text-xs text-muted-foreground">
              Merged into <span className="font-mono">{info?.file ?? c.configPath}</span>
              {info?.format === 'json' ? ` under "${info.key}"` : ''}:
            </p>
            <Snippet title={c.configPath} code={configSnippet(c.id, port, profile)} />
          </CollapsibleContent>
        </Collapsible>
      </CardFooter>
    </Card>
  )
}

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

function RulesCard({ rules, profiles, port }: { rules: ClientRule[]; profiles: string[]; port?: number }) {
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
  const shared = sharedUrl(port)

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
          Only for clients connected to the shared URL (automatic mode). The client's MCP name is matched
          against each pattern (glob, case-insensitive); the first match picks the profile. Rules are saved in
          config.json.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <UrlField url={shared} label="Shared URL" />
          <Collapsible>
            <CollapsibleTrigger
              render={<Button variant="ghost" size="sm" className="group/entry -ml-2 w-fit" />}
            >
              Entry for mcp.json
              <ChevronDownIcon
                data-icon="inline-end"
                className="transition-transform group-data-[panel-open]/entry:rotate-180"
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <Snippet title="mcp.json (shared URL)" code={configSnippet('cursor', port, null)} />
            </CollapsibleContent>
          </Collapsible>
        </div>
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

const NONE = '__none__'

function DefaultProfileCard({ current, profiles }: { current?: string; profiles: string[] }) {
  const qc = useQueryClient()
  const save = useMutation({
    mutationFn: (profile: string | null) => put('/default-profile', { profile }),
    onSuccess: (_d, p) => {
      void qc.invalidateQueries({ queryKey: keys.config })
      toast.success(p ? `Default profile: ${p} (saved)` : 'Default profile cleared (saved)')
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Card id="default" className="scroll-mt-20">
      <CardHeader>
        <CardTitle>Default profile</CardTitle>
        <CardDescription>
          The fallback for clients on the shared URL when no client rule matches. Clients connected with a
          profile URL (/p/&lt;name&gt;/mcp) ignore it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Field data-disabled={save.isPending || undefined}>
          <FieldLabel htmlFor="default-profile">Default profile</FieldLabel>
          <SimpleSelect
            id="default-profile"
            value={current ?? NONE}
            disabled={save.isPending}
            onValueChange={(v) => save.mutate(v === NONE ? null : v)}
            options={[
              { value: NONE, label: 'None: refuse unmatched clients' },
              ...profiles.map((p) => ({ value: p, label: p })),
            ]}
          />
          <FieldDescription>
            {current
              ? `Unmatched clients get "${current}". Saved immediately to config.json.`
              : 'With no default, a client on the shared URL that matches no rule is refused.'}
          </FieldDescription>
        </Field>
        {save.error ? <ErrorAlert error={save.error} /> : null}
      </CardContent>
    </Card>
  )
}
