import { useMutation, useQueryClient } from '@tanstack/react-query'
import { KeyRoundIcon, TriangleAlertIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ConfirmButton, CopyButton, ErrorAlert, Snippet, UrlField } from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { del, enc, post } from '@/lib/api'
import { relativeTime } from '@/lib/format'
import { keys, useApiKeys } from '@/lib/queries'
import type { CreatedApiKey } from '@/lib/types'

/** Create an API key for one client; the token is shown once. */
export function CreateKeyDialog({
  client,
  clientName,
  open,
  onOpenChange,
}: {
  client: string
  clientName?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        {open && (
          <CreateKeyBody client={client} clientName={clientName ?? client} done={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function CreateKeyBody({
  client,
  clientName,
  done,
}: {
  client: string
  clientName: string
  done: () => void
}) {
  const qc = useQueryClient()
  const [label, setLabel] = useState('')
  const create = useMutation({
    mutationFn: () =>
      post<CreatedApiKey>('/keys', { client, ...(label.trim() ? { label: label.trim() } : {}) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.apiKeys })
      void qc.invalidateQueries({ queryKey: keys.status })
    },
  })

  if (create.data) {
    const { token, url } = create.data
    const snippet = JSON.stringify(
      { mcpServers: { switchboard: { url, headers: { Authorization: `Bearer ${token}` } } } },
      null,
      2,
    )
    return (
      <>
        <DialogHeader>
          <DialogTitle>API key for {clientName}</DialogTitle>
          <DialogDescription>
            Paste it into {clientName}'s MCP config, then restart it once.
          </DialogDescription>
        </DialogHeader>
        <Alert>
          <TriangleAlertIcon />
          <AlertTitle>Copy it now: it won't be shown again</AlertTitle>
          <AlertDescription>
            Only a hash is stored. If you lose it, revoke it and create a new one.
          </AlertDescription>
        </Alert>
        <UrlField url={token} label="API key" />
        <Snippet title="mcp.json" code={snippet} />
        <DialogFooter>
          <CopyButton text={snippet} label="Copy config" variant="outline" size="default" />
          <Button onClick={done}>Done</Button>
        </DialogFooter>
      </>
    )
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        create.mutate()
      }}
    >
      <DialogHeader>
        <DialogTitle>Create an API key for {clientName}</DialogTitle>
        <DialogDescription>
          The key identifies this client: requests with it use {clientName}'s profile. Needed when Switchboard
          is hosted.
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="key-label">Label (optional)</FieldLabel>
          <Input
            id="key-label"
            value={label}
            maxLength={100}
            placeholder="Work laptop"
            onChange={(e) => setLabel(e.target.value)}
          />
          <FieldDescription>Helps you tell keys apart later.</FieldDescription>
        </Field>
      </FieldGroup>
      {create.error ? <ErrorAlert error={create.error} title="Could not create the key" /> : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={done}>
          Cancel
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <KeyRoundIcon data-icon="inline-start" />
          )}
          Create key
        </Button>
      </DialogFooter>
    </form>
  )
}

/** The keys of one client, with Revoke. Renders nothing when it has none. */
export function ClientKeys({ client }: { client: string }) {
  const apiKeys = useApiKeys()
  const qc = useQueryClient()
  const list = (apiKeys.data ?? []).filter((k) => k.client === client)
  if (!list.length) return null
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-medium text-muted-foreground">API keys</p>
      <ul className="flex flex-col divide-y rounded-lg border">
        {list.map((k) => (
          <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <KeyRoundIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="truncate font-medium">{k.label || 'Unlabeled key'}</span>
              <span className="text-xs text-muted-foreground">
                created {relativeTime(k.createdAt)} ·{' '}
                {k.lastUsedAt ? `used ${relativeTime(k.lastUsedAt)}` : 'never used'}
              </span>
            </span>
            <ConfirmButton
              size="sm"
              variant="outline"
              title={`Revoke "${k.label || 'Unlabeled key'}"?`}
              description="Clients using this key are refused from now on. This cannot be undone."
              confirmLabel="Revoke"
              onConfirm={async () => {
                await del(`/keys/${enc(k.id)}`)
                void qc.invalidateQueries({ queryKey: keys.apiKeys })
                void qc.invalidateQueries({ queryKey: keys.status })
                toast.success('Key revoked')
              }}
            >
              Revoke
            </ConfirmButton>
          </li>
        ))}
      </ul>
    </div>
  )
}
