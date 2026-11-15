import { brand } from '@switchboard/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRoundIcon, SearchXIcon } from 'lucide-react'
import { lazy, Suspense, useEffect } from 'react'
import { AppSidebar } from '@/components/app-sidebar'
import { InlineCode, LoadingState, Page } from '@/components/common'
import { LoginScreen } from '@/components/login'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { Spinner } from '@/components/ui/spinner'
import { adminToken, auth, onUnauthorized } from '@/lib/api'
import { useLiveEvents } from '@/lib/queries'
import { Link, match, useLocation } from '@/lib/router'
import { ClientsPage } from '@/pages/Clients'
import { ImportPage } from '@/pages/Import'
import { OverviewPage } from '@/pages/Overview'
import { ProfileEditor, ProfilesPage } from '@/pages/Profiles'
import { SecretsPage } from '@/pages/Secrets'
import { ServerDetail, ServerNew, ServersPage } from '@/pages/Servers'

// Charts (Recharts) load only when the Activity page is opened.
const ActivityPage = lazy(() => import('@/pages/Activity').then((m) => ({ default: m.ActivityPage })))

function Routes() {
  const { path } = useLocation()
  if (path === '/') return <OverviewPage />
  if (path === '/servers') return <ServersPage />
  if (path === '/servers/new') return <ServerNew />
  const server = match('/servers/:name', path)
  if (server) return <ServerDetail key={server.name} name={server.name!} />
  if (path === '/import') return <ImportPage />
  if (path === '/profiles') return <ProfilesPage />
  if (path === '/profiles/new') return <ProfileEditor key="new" />
  const profile = match('/profiles/:name', path)
  if (profile) return <ProfileEditor key={profile.name} name={profile.name!} />
  if (path === '/clients') return <ClientsPage />
  if (path === '/secrets') return <SecretsPage />
  if (path === '/activity')
    return (
      <Suspense
        fallback={
          <Page title="Activity">
            <LoadingState />
          </Page>
        }
      >
        <ActivityPage />
      </Suspense>
    )
  return (
    <Page title="Not found">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SearchXIcon />
          </EmptyMedia>
          <EmptyTitle>Page not found</EmptyTitle>
          <EmptyDescription>
            Nothing lives at <InlineCode>{path}</InlineCode>.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button render={<Link to="/" />} nativeButton={false}>
            Go to the overview
          </Button>
        </EmptyContent>
      </Empty>
    </Page>
  )
}

function NoToken() {
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <KeyRoundIcon />
          </EmptyMedia>
          <EmptyTitle>No admin token</EmptyTitle>
          <EmptyDescription>
            This page was not served by the {brand.displayName} daemon, so it cannot talk to the admin API.
            Start it with <InlineCode>npx {brand.packageName} up</InlineCode> and open the URL it prints.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </main>
  )
}

function Shell() {
  const qc = useQueryClient()
  const live = useLiveEvents(qc)
  return (
    <SidebarProvider>
      <AppSidebar live={live} />
      <SidebarInset className="min-w-0">
        <Routes />
      </SidebarInset>
    </SidebarProvider>
  )
}

const SESSION_KEY = ['auth-session'] as const

/** Hosted mode: the page has no token, so a cookie session (password login) gates the app. */
function HostedGate() {
  const qc = useQueryClient()
  const session = useQuery({
    queryKey: SESSION_KEY,
    queryFn: auth.session,
    retry: false,
    staleTime: Infinity,
  })
  useEffect(
    () =>
      onUnauthorized(() => {
        qc.setQueryData<Awaited<ReturnType<typeof auth.session>>>(SESSION_KEY, (s) =>
          s ? { ...s, authenticated: false } : s,
        )
      }),
    [qc],
  )
  if (session.isPending)
    return (
      <main className="flex min-h-svh items-center justify-center" role="status" aria-label="Loading">
        <Spinner className="size-6 text-muted-foreground" />
      </main>
    )
  if (session.error || !session.data) return <NoToken />
  if (session.data.authenticated) return <Shell />
  if (!session.data.remote) return <NoToken />
  return (
    <LoginScreen
      passwordSet={session.data.passwordSet}
      onSignedIn={() => {
        // Drop anything cached under the old (missing) session, then show the app.
        qc.removeQueries({ predicate: (q) => q.queryKey[0] !== SESSION_KEY[0] })
        qc.setQueryData(SESSION_KEY, { ...session.data, authenticated: true })
      }}
    />
  )
}

export function App() {
  return adminToken ? <Shell /> : <HostedGate />
}
