import { brand } from '@switchboard/shared'
import { useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'
import { adminToken } from './lib/api.ts'
import { type LiveState, useLiveEvents, useStatus } from './lib/queries.ts'
import { Link, match, useLocation } from './lib/router.tsx'
import { cx, Dot, EmptyState, InlineCode } from './lib/ui.tsx'
import { ActivityPage } from './pages/Activity.tsx'
import { ClientsPage } from './pages/Clients.tsx'
import { ImportPage } from './pages/Import.tsx'
import { OverviewPage } from './pages/Overview.tsx'
import { ProfileEditor, ProfilesPage } from './pages/Profiles.tsx'
import { SecretsPage } from './pages/Secrets.tsx'
import { ServerDetail, ServerNew, ServersPage } from './pages/Servers.tsx'

const NAV: { to: string; label: string; icon: ReactNode }[] = [
  { to: '/', label: 'Overview', icon: <path d="M3 10.5 10 4l7 6.5V17H3z" /> },
  { to: '/servers', label: 'Servers', icon: <path d="M3 4h14v5H3zM3 11h14v5H3zM6 6.5h.01M6 13.5h.01" /> },
  { to: '/profiles', label: 'Profiles', icon: <path d="M4 5h12M4 10h12M4 15h7" /> },
  {
    to: '/clients',
    label: 'Clients',
    icon: <path d="M3 4h14v9H3zM7 17h6M10 13v4" />,
  },
  { to: '/import', label: 'Import', icon: <path d="M10 3v10m0 0-4-4m4 4 4-4M4 17h12" /> },
  {
    to: '/secrets',
    label: 'Secrets',
    icon: <path d="M5 9h10v8H5zM7 9V6a3 3 0 0 1 6 0v3" />,
  },
  { to: '/activity', label: 'Activity', icon: <path d="M2 10h4l2-5 4 10 2-5h4" /> },
]

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
  if (path === '/activity') return <ActivityPage />
  return (
    <EmptyState
      title="Page not found"
      action={
        <Link to="/" className="text-sm text-accent">
          Go to the overview
        </Link>
      }
    >
      Nothing lives at <InlineCode>{path}</InlineCode>.
    </EmptyState>
  )
}

const liveLabel: Record<LiveState, string> = { live: 'Live', connecting: 'Connecting', offline: 'Offline' }

function Sidebar({ live, onNavigate }: { live: LiveState; onNavigate?: () => void }) {
  const { path } = useLocation()
  const status = useStatus()
  return (
    <nav aria-label="Main" className="flex h-full flex-col">
      <Link to="/" onClick={onNavigate} className="mb-5 flex items-center gap-2 px-2">
        <img src="/favicon.svg" alt="" className="size-6" />
        <span className="text-[15px] font-semibold tracking-tight">{brand.displayName}</span>
      </Link>
      <ul className="space-y-0.5">
        {NAV.map((item) => {
          const active = item.to === '/' ? path === '/' : path === item.to || path.startsWith(`${item.to}/`)
          return (
            <li key={item.to}>
              <Link
                to={item.to}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors',
                  active ? 'bg-subtle font-medium text-fg' : 'text-muted hover:bg-subtle hover:text-fg',
                )}
              >
                <svg
                  viewBox="0 0 20 20"
                  className="size-4 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  {item.icon}
                </svg>
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
      <div className="mt-auto space-y-1 px-2 pt-6 text-xs text-muted">
        <div className="flex items-center gap-2">
          <Dot
            tone={live === 'live' ? 'ok' : live === 'connecting' ? 'warn' : 'bad'}
            pulse={live === 'live'}
          />
          {liveLabel[live]}
          {status.data?.port ? <span className="text-faint">· :{status.data.port}</span> : null}
        </div>
        {status.data && <div className="text-faint">v{status.data.version}</div>}
        <a href={brand.docsUrl} target="_blank" rel="noreferrer" className="block hover:text-fg">
          Docs ↗
        </a>
      </div>
    </nav>
  )
}

export function App() {
  const qc = useQueryClient()
  const live = useLiveEvents(qc)
  const [menuOpen, setMenuOpen] = useState(false)

  if (!adminToken) {
    return (
      <main className="mx-auto max-w-lg px-6 py-24">
        <EmptyState title="No admin token">
          This page was not served by the {brand.displayName} daemon, so it cannot talk to the admin API.
          Start it with <InlineCode>npx {brand.packageName} up</InlineCode> and open the URL it prints.
        </EmptyState>
      </main>
    )
  }

  return (
    <div className="min-h-screen md:grid md:grid-cols-[220px_1fr]">
      <aside className="sticky top-0 hidden h-screen border-r border-line bg-panel/60 px-3 py-4 md:block">
        <Sidebar live={live} />
      </aside>
      <div className="flex items-center justify-between border-b border-line bg-panel px-4 py-2 md:hidden">
        <span className="font-semibold">{brand.displayName}</span>
        <button
          type="button"
          className="rounded-md border border-line-strong px-2 py-1 text-sm"
          aria-expanded={menuOpen}
          aria-controls="mobile-nav"
          onClick={() => setMenuOpen((o) => !o)}
        >
          Menu
        </button>
      </div>
      {menuOpen && (
        <div id="mobile-nav" className="border-b border-line bg-panel px-3 py-3 md:hidden">
          <Sidebar live={live} onNavigate={() => setMenuOpen(false)} />
        </div>
      )}
      <main className="min-w-0 px-4 py-6 md:px-8 md:py-8">
        <div className="mx-auto max-w-6xl">
          <Routes />
        </div>
      </main>
    </div>
  )
}
