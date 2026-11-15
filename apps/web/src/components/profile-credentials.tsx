import type { Credential, Profile, ServerConfig } from '@switchboard/shared'
import { KeyRoundIcon, TriangleAlertIcon } from 'lucide-react'
import { useState } from 'react'
import { InlineCode } from '@/components/common'
import { ServerState, SignInButton } from '@/components/server-status'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { fromKV, type KV, KVEditor, toKV } from '@/lib/kv'
import { useSecrets, useServers } from '@/lib/queries'
import { Link } from '@/lib/router'
import type { ServerInstanceRow } from '@/lib/types'

const SECRET_RE = /secret:\/\/([A-Za-z0-9_.-]+)/g

/**
 * Which credentials each of the profile's servers runs with: the server's
 * own, or a separate account for this profile with its own keys, process
 * and sign-in.
 */
export function CredentialsCard({
  profileName,
  draft,
  set,
}: {
  profileName: string
  draft: Profile
  set: (patch: Partial<Profile>) => void
}) {
  const servers = useServers()
  const listed = draft.servers.filter((s) => servers.data?.some((r) => r.name === s))
  if (!listed.length) return null

  const update = (server: string, credential: Credential | undefined) => {
    const next = { ...draft.credentials }
    if (credential) next[server] = credential
    else delete next[server]
    set({ credentials: next })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Credentials</CardTitle>
        <CardDescription>
          By default a server runs with the keys in its own settings, shared by every profile. Give this
          profile a separate account to use other keys, or another sign-in; tool names stay the same.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {listed.map((server) => {
          const row = servers.data!.find((r) => r.name === server)!
          return (
            <ServerCredential
              key={server}
              server={server}
              config={row.config}
              profileName={profileName}
              credential={draft.credentials[server]}
              instance={row.instances?.find((x) => x.profiles.includes(profileName))}
              onChange={(c) => update(server, c)}
            />
          )
        })}
      </CardContent>
    </Card>
  )
}

function ServerCredential({
  server,
  config,
  profileName,
  credential,
  instance,
  onChange,
}: {
  server: string
  config: ServerConfig
  profileName: string
  credential: Credential | undefined
  instance?: ServerInstanceRow
  onChange: (c: Credential | undefined) => void
}) {
  const stdio = config.transport === 'stdio'
  const own = !!credential
  // Rows are kept here so a half-typed row (no key yet) is not dropped.
  const [rows, setRows] = useState<KV[]>(() => toKV(stdio ? credential?.env : credential?.headers))
  const secrets = useSecrets()
  const id = `own-${server}`
  const account = credential?.account ?? profileName
  const sharedWith = instance?.account ? instance.profiles.filter((p) => p !== profileName) : []
  const missing = secrets.data
    ? [...new Set(rows.flatMap((r) => [...r.value.matchAll(SECRET_RE)].map((m) => m[1]!)))].filter(
        (n) => !secrets.data.names.includes(n),
      )
    : []

  const setRowsAndCredential = (next: KV[]) => {
    setRows(next)
    onChange({ ...credential, env: stdio ? fromKV(next) : {}, headers: stdio ? {} : fromKV(next) })
  }

  return (
    <div className="flex flex-col gap-2">
      <FieldLabel htmlFor={id}>
        <Field orientation="horizontal">
          <FieldContent className="min-w-0">
            <FieldTitle className="flex flex-wrap items-center gap-2">
              <span className="font-mono">{server}</span>
              {own ? (
                <Badge variant="secondary" className="font-mono">
                  {server}.{account}
                </Badge>
              ) : (
                <Badge variant="outline">server's own credentials</Badge>
              )}
            </FieldTitle>
            <FieldDescription>
              {own
                ? `Runs as a separate account for this profile${sharedWith.length ? `, shared with ${sharedWith.join(', ')}` : ''}.`
                : 'Use a separate account for this profile.'}
            </FieldDescription>
          </FieldContent>
          <Switch
            id={id}
            checked={own}
            onCheckedChange={(on) => {
              if (on) onChange({ env: stdio ? fromKV(rows) : {}, headers: stdio ? {} : fromKV(rows) })
              else onChange(undefined)
            }}
          />
        </Field>
      </FieldLabel>

      {own && (
        <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3">
          <Field>
            <FieldLabel htmlFor={`${id}-account`}>Account name</FieldLabel>
            <Input
              id={`${id}-account`}
              className="max-w-64 font-mono"
              placeholder={profileName}
              value={credential.account ?? ''}
              onChange={(e) => {
                const value = e.target.value.trim()
                const { account: _old, ...rest } = credential
                onChange(value ? { ...rest, account: value } : rest)
              }}
            />
            <FieldDescription>
              Profiles that use the same account name share one {server} process and one sign-in.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel>{stdio ? 'Environment variables' : 'Headers'}</FieldLabel>
            <KVEditor
              rows={rows}
              onChange={setRowsAndCredential}
              keyLabel={stdio ? 'Variable' : 'Header'}
              valueLabel="Value"
              keyPlaceholder={stdio ? 'GITHUB_TOKEN' : 'Authorization'}
              valuePlaceholder={
                stdio ? `secret://${server}-${account}` : `Bearer secret://${server}-${account}`
              }
              addLabel={stdio ? 'Add variable' : 'Add header'}
            />
            <FieldDescription>
              Set over {server}'s own {stdio ? 'environment' : 'headers'}. Store keys on the{' '}
              <Link to="/secrets" className="underline underline-offset-2 hover:text-foreground">
                Secrets
              </Link>{' '}
              page and write <InlineCode>secret://NAME</InlineCode>.
              {!stdio && !rows.length && ' Leave empty to sign in to a different account with OAuth.'}
              {missing.length > 0 && (
                <span className="mt-1 flex items-center gap-1.5 text-foreground">
                  <TriangleAlertIcon className="size-3.5 text-warning" aria-hidden="true" />
                  Not stored yet: {missing.map((m) => `secret://${m}`).join(', ')}.
                </span>
              )}
            </FieldDescription>
          </Field>
          {instance?.account && instance.status && (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <KeyRoundIcon className="size-4 text-muted-foreground" aria-hidden="true" />
              <ServerState status={instance.status} enabled={config.enabled} />
              {instance.status.state === 'needs-auth' && <SignInButton name={instance.id} />}
              {instance.status.state === 'error' && instance.status.lastError && (
                <span className="w-full text-xs break-words text-destructive">
                  {instance.status.lastError}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
