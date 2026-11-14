import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { del, enc, put } from '../lib/api.ts'
import { keys, useSecrets } from '../lib/queries.ts'
import {
  Badge,
  Button,
  Card,
  ConfirmButton,
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

const NAME_RE = /^[A-Za-z0-9_.-]+$/

export function SecretsPage() {
  const secrets = useSecrets()
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [touched, setTouched] = useState(false)
  const qc = useQueryClient()
  const toast = useToast()
  const exists = secrets.data?.names.includes(name.trim())

  const save = useMutation({
    mutationFn: () => put(`/secrets/${enc(name.trim())}`, { value }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.secrets })
      toast(`${exists ? 'Replaced' : 'Stored'} secret://${name.trim()}`, 'ok')
      setName('')
      setValue('')
      setTouched(false)
    },
  })

  const nameError =
    touched && !NAME_RE.test(name.trim()) ? 'Letters, digits, ".", "-" and "_" only.' : undefined
  const valueError = touched && !value ? 'Enter a value.' : undefined

  return (
    <>
      <PageHeader
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
            <Badge tone={secrets.data.backend === 'keychain' ? 'ok' : 'warn'}>
              {secrets.data.backend === 'keychain' ? 'OS keychain' : `stored in ${secrets.data.backend}`}
            </Badge>
          )
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
        <Card title="Stored secrets" bodyClassName="">
          {secrets.isPending ? (
            <div className="px-4">
              <Loading />
            </div>
          ) : secrets.error ? (
            <div className="p-4">
              <ErrorBox error={secrets.error} />
            </div>
          ) : !secrets.data.names.length ? (
            <div className="p-4">
              <EmptyState title="No secrets yet">
                Add an API token on the right, then use <InlineCode>secret://its-name</InlineCode> in a
                server's settings instead of the raw value.
              </EmptyState>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {secrets.data.names.map((n) => (
                <li key={n} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <code className="font-mono text-sm">{n}</code>
                    <div className="font-mono text-xs text-faint">secret://{n}</div>
                  </div>
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="ghost" onClick={() => setName(n)}>
                      Replace
                    </Button>
                    <ConfirmButton
                      size="sm"
                      title={`Delete secret "${n}"?`}
                      body={
                        <>
                          Servers that use <InlineCode>secret://{n}</InlineCode> will fail to start until it
                          is added again.
                        </>
                      }
                      onConfirm={async () => {
                        await del(`/secrets/${enc(n)}`)
                        void qc.invalidateQueries({ queryKey: keys.secrets })
                        toast(`Deleted ${n}`)
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

        <Card title={exists ? 'Replace secret' : 'Add secret'} className="lg:self-start">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              setTouched(true)
              if (!NAME_RE.test(name.trim()) || !value) return
              save.mutate()
            }}
          >
            <Field
              label="Name"
              error={nameError}
              hint={name.trim() ? `Use as secret://${name.trim()}` : undefined}
            >
              {(id, d) => (
                <input
                  id={id}
                  aria-describedby={d}
                  aria-invalid={!!nameError}
                  className={monoInputClass}
                  value={name}
                  placeholder="github-token"
                  autoComplete="off"
                  onChange={(e) => setName(e.target.value)}
                />
              )}
            </Field>
            <Field label="Value" error={valueError} hint="Write-only: it cannot be read back from here.">
              {(id, d) => (
                <input
                  id={id}
                  aria-describedby={d}
                  aria-invalid={!!valueError}
                  type="password"
                  autoComplete="new-password"
                  className={inputClass}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              )}
            </Field>
            {exists && (
              <p className="text-xs text-warn">A secret with this name exists; saving replaces it.</p>
            )}
            {save.error && <ErrorBox error={save.error} />}
            <Button type="submit" variant="primary" loading={save.isPending} className="w-full">
              {exists ? 'Replace' : 'Store secret'}
            </Button>
          </form>
        </Card>
      </div>
    </>
  )
}
