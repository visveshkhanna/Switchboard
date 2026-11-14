import { brand } from '@switchboard/shared'
import { useQueryClient } from '@tanstack/react-query'
import { KeyRoundIcon, SearchXIcon } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { AppSidebar } from '@/components/app-sidebar'
import { InlineCode, LoadingState, Page } from '@/components/common'
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
import { adminToken } from '@/lib/api'
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

export function App() {
  const qc = useQueryClient()
  const live = useLiveEvents(qc)

  if (!adminToken) {
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

  return (
    <SidebarProvider>
      <AppSidebar live={live} />
      <SidebarInset className="min-w-0">
        <Routes />
      </SidebarInset>
    </SidebarProvider>
  )
}
