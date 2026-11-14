import { useMutation, useQueryClient } from '@tanstack/react-query'
import { KeyRoundIcon, LockIcon, TriangleAlertIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ConfirmButton, ErrorAlert, InlineCode, LoadingState, Page } from '@/components/common'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { del, enc, put } from '@/lib/api'
import { keys, useSecrets } from '@/lib/queries'

const NAME_RE = /^[A-Za-z0-9_.-]+$/

export function SecretsPage() {
  const secrets = useSecrets()
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [touched, setTouched] = useState(false)
  const qc = useQueryClient()
  const exists = secrets.data?.names.includes(name.trim())

  const save = useMutation({
    mutationFn: () => put(`/secrets/${enc(name.trim())}`, { value }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.secrets })
      toast.success(`${exists ? 'Replaced' : 'Stored'} secret://${name.trim()}`)
      setName('')
      setValue('')
      setTouched(false)
    },
  })

  const nameError =
    touched && !NAME_RE.test(name.trim()) ? 'Letters, digits, ".", "-" and "_" only.' : undefined
  const valueError = touched && !value ? 'Enter a value.' : undefined
  const keychain = secrets.data?.backend === 'keychain'

  return (
    <Page
      title="Secrets"
      description={
        <>
          Store tokens once and reference them as <InlineCode>secret://NAME</InlineCode> in a server's
          environment variables, headers, arguments or URL. Values are resolved only when the server starts
          and are never shown again.
        </>
      }
      actions={
        secrets.data && (
          <Badge variant={keychain ? 'secondary' : 'outline'}>
            {keychain ? (
              <LockIcon data-icon="inline-start" />
            ) : (
              <TriangleAlertIcon data-icon="inline-start" />
            )}
            {keychain ? 'OS keychain' : `Stored in ${secrets.data.backend}`}
          </Badge>
        )
      }
    >
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[1fr_360px]">
        <Card className="pb-0">
          <CardHeader className="border-b">
            <CardTitle>Stored secrets</CardTitle>
            <CardDescription>Names only; values cannot be read back.</CardDescription>
          </CardHeader>
          {secrets.isPending ? (
            <CardContent className="pb-4">
              <LoadingState rows={2} />
            </CardContent>
          ) : secrets.error ? (
            <CardContent className="pb-4">
              <ErrorAlert error={secrets.error} />
            </CardContent>
          ) : !secrets.data.names.length ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <KeyRoundIcon />
                </EmptyMedia>
                <EmptyTitle>No secrets yet</EmptyTitle>
                <EmptyDescription>
                  Add an API token, then use <InlineCode>secret://its-name</InlineCode> in a server's settings
                  instead of the raw value.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="divide-y">
              {secrets.data.names.map((n) => (
                <li key={n} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="flex min-w-0 flex-col">
                    <code className="truncate font-mono text-sm">{n}</code>
                    <span className="truncate font-mono text-xs text-muted-foreground">secret://{n}</span>
                  </div>
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="ghost" onClick={() => setName(n)}>
                      Replace
                    </Button>
                    <ConfirmButton
                      size="sm"
                      title={`Delete secret "${n}"?`}
                      description={
                        <>
                          Servers that use <InlineCode>secret://{n}</InlineCode> will fail to start until it
                          is added again.
                        </>
                      }
                      onConfirm={async () => {
                        await del(`/secrets/${enc(n)}`)
                        void qc.invalidateQueries({ queryKey: keys.secrets })
                        toast.success(`Deleted ${n}`)
                      }}
                    >
                      Delete
                    </ConfirmButton>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{exists ? 'Replace secret' : 'Add secret'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                setTouched(true)
                if (!NAME_RE.test(name.trim()) || !value) return
                save.mutate()
              }}
            >
              <FieldGroup>
                <Field data-invalid={!!nameError || undefined}>
                  <FieldLabel htmlFor="secret-name">Name</FieldLabel>
                  <Input
                    id="secret-name"
                    aria-invalid={!!nameError || undefined}
                    className="font-mono"
                    value={name}
                    placeholder="github-token"
                    autoComplete="off"
                    onChange={(e) => setName(e.target.value)}
                  />
                  {nameError ? (
                    <FieldError>{nameError}</FieldError>
                  ) : name.trim() ? (
                    <FieldDescription>Use as secret://{name.trim()}</FieldDescription>
                  ) : null}
                </Field>
                <Field data-invalid={!!valueError || undefined}>
                  <FieldLabel htmlFor="secret-value">Value</FieldLabel>
                  <Input
                    id="secret-value"
                    aria-invalid={!!valueError || undefined}
                    type="password"
                    autoComplete="new-password"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                  />
                  {valueError ? (
                    <FieldError>{valueError}</FieldError>
                  ) : (
                    <FieldDescription>Write-only: it cannot be read back from here.</FieldDescription>
                  )}
                </Field>
                {exists && (
                  <Alert>
                    <TriangleAlertIcon />
                    <AlertDescription>A secret with this name exists; saving replaces it.</AlertDescription>
                  </Alert>
                )}
                {save.error && <ErrorAlert error={save.error} />}
                <Button type="submit" disabled={save.isPending} className="w-full">
                  {save.isPending && <Spinner data-icon="inline-start" />}
                  {exists ? 'Replace' : 'Store secret'}
                </Button>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      </div>
    </Page>
  )
}
