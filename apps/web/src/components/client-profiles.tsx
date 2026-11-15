import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ClockIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { enc, errorMessage, put } from '@/lib/api'
import { keys, useClients, useConfig } from '@/lib/queries'
import type { ClientRow } from '@/lib/types'
import { cn } from '@/lib/utils'

export type ProfileChoice = { profile: string | null } | { useDefault: true }

/** A client is waiting when it is connected but no profile applies to it. */
export function isWaiting(c: ClientRow): boolean {
  return c.via === 'unassigned' && c.sessions > 0
}

export function useWaitingClients(): ClientRow[] {
  const clients = useClients()
  return (clients.data ?? []).filter(isWaiting)
}

/** The profile a row shows as switched on, if any. */
export function activeProfile(c: ClientRow): string | null {
  return c.selection === 'off' ? null : c.effectiveProfile
}

/** Switch a client's profile, optimistically; open sessions move on the server at once. */
export function useSetClientProfile() {
  const qc = useQueryClient()
  const config = useConfig()
  return useMutation({
    mutationFn: ({ id, choice }: { id: string; choice: ProfileChoice }) =>
      put<ClientRow>(`/clients/${enc(id)}/profile`, choice),
    onMutate: async ({ id, choice }) => {
      await qc.cancelQueries({ queryKey: keys.clients })
      const before = qc.getQueryData<ClientRow[]>(keys.clients)
      const fallback = config.data?.defaultProfile ?? null
      qc.setQueryData<ClientRow[]>(keys.clients, (old) =>
        old?.map((c): ClientRow => {
          if (c.id !== id) return c
          if ('useDefault' in choice)
            return {
              ...c,
              selection: 'default',
              profile: null,
              effectiveProfile: fallback,
              via: fallback ? 'default' : 'unassigned',
            }
          if (choice.profile === null)
            return { ...c, selection: 'off', profile: null, effectiveProfile: null, via: 'disabled' }
          return {
            ...c,
            selection: 'profile',
            profile: choice.profile,
            effectiveProfile: choice.profile,
            via: 'client',
          }
        }),
      )
      return { before }
    },
    onError: (e, _v, ctx) => {
      if (ctx?.before) qc.setQueryData(keys.clients, ctx.before)
      toast.error(`Could not switch the profile: ${errorMessage(e)}`)
    },
    onSuccess: (row) => {
      if (row)
        qc.setQueryData<ClientRow[]>(keys.clients, (old) => old?.map((c) => (c.id === row.id ? row : c)))
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.clients })
      void qc.invalidateQueries({ queryKey: keys.sessions })
    },
  })
}

/** One switch per profile; at most one is on. */
export function ProfileSwitches({
  client,
  profiles,
  className,
}: {
  client: ClientRow
  profiles: string[]
  className?: string
}) {
  const set = useSetClientProfile()
  const active = activeProfile(client)
  if (!profiles.length)
    return <p className="text-sm text-muted-foreground">Create a profile to switch it on here.</p>
  return (
    <fieldset className={cn('flex flex-wrap gap-2', className)}>
      <legend className="sr-only">Profile for {client.name}</legend>
      {profiles.map((p) => {
        const on = active === p
        const id = `client-${client.id}-profile-${p}`
        return (
          <label
            key={p}
            htmlFor={id}
            className={cn(
              'flex h-8 cursor-pointer items-center gap-2 rounded-lg border px-2.5 text-sm transition-colors hover:bg-muted',
              on && 'border-primary/40 bg-primary/5',
            )}
          >
            <Switch
              id={id}
              size="sm"
              checked={on}
              onCheckedChange={(next) => set.mutate({ id: client.id, choice: { profile: next ? p : null } })}
            />
            <span className={cn('font-medium', !on && 'text-muted-foreground')}>{p}</span>
            {on && client.selection === 'default' && (
              <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                default
              </Badge>
            )}
          </label>
        )
      })}
    </fieldset>
  )
}

/** Overview banners: one per client connected without a profile. */
export function WaitingBanners() {
  const waiting = useWaitingClients()
  const config = useConfig()
  const profiles = Object.keys(config.data?.profiles ?? {})
  if (!waiting.length) return null
  return (
    <section className="flex flex-col gap-2" aria-label="Clients waiting for a profile">
      {waiting.map((c) => (
        <Alert key={c.id}>
          <ClockIcon />
          <AlertTitle>{c.name} is waiting for a profile</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <span>It is connected but gets no tools yet. Turn a profile on; it applies instantly.</span>
            <ProfileSwitches client={c} profiles={profiles} />
          </AlertDescription>
        </Alert>
      ))}
    </section>
  )
}
