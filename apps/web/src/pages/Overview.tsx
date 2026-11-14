import type { ReactNode } from 'react'
import { useServers, useSessions, useStatus } from '../lib/queries.ts'
import { Link } from '../lib/router.tsx'
import {
  Badge,
  Card,
  EmptyState,
  ErrorBox,
  InlineCode,
  Loading,
  PageHeader,
  relativeTime,
  tdClass,
  thClass,
  useTick,
} from '../lib/ui.tsx'

const VIA: Record<string, string> = {
  path: 'URL path',
  header: 'header',
  'client-rule': 'client rule',
  default: 'default profile',
}

export function viaLabel(via: string): string {
  return VIA[via] ?? via
}

function Stat({ label, value, sub, to }: { label: string; value: ReactNode; sub?: ReactNode; to: string }) {
  return (
    <Link
      to={to}
      className="block rounded-lg border border-line bg-panel px-4 py-3 shadow-xs transition-colors hover:border-line-strong"
    >
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </Link>
  )
}

const quickLinks = [
  { to: '/import', title: 'Import servers', body: 'Bring in the MCP servers your clients already use.' },
  {
    to: '/profiles/new',
    title: 'Create profile',
    body: 'Group servers and choose which tools a client sees.',
  },
  { to: '/clients', title: 'Connect a client', body: 'Point Cursor, Claude Code or VS Code at a profile.' },
]

export function OverviewPage() {
  useTick()
  const status = useStatus()
  const servers = useServers()
  const sessions = useSessions()

  if (status.isPending) return <Loading />
  if (status.error) return <ErrorBox error={status.error} title="Could not reach the daemon" />
  const s = status.data
  const ready = servers.data?.filter((r) => r.status?.state === 'ready').length ?? 0
  const errored = servers.data?.filter((r) => r.status?.state === 'error').length ?? 0

  return (
    <>
      <PageHeader
        title="Overview"
        description={
          <>
            Daemon v{s.version} on port {s.port ?? '—'} · pid {s.pid} · started {relativeTime(s.startedAt)}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat
          label="Servers"
          value={s.servers}
          to="/servers"
          sub={
            s.servers ? (
              <>
                {ready} running{errored ? <span className="text-bad"> · {errored} failing</span> : null}
              </>
            ) : (
              'none yet'
            )
          }
        />
        <Stat
          label="Profiles"
          value={s.profiles}
          to="/profiles"
          sub={s.profiles ? 'endpoints at /p/<name>/mcp' : 'none yet'}
        />
        <Stat label="Active sessions" value={s.sessions} to="/activity" sub="connected MCP clients" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
        {quickLinks.map((q) => (
          <Link
            key={q.to}
            to={q.to}
            className="group rounded-lg border border-line bg-panel px-4 py-3 shadow-xs transition-colors hover:border-accent/50"
          >
            <div className="text-sm font-medium text-fg group-hover:text-accent">{q.title} →</div>
            <div className="mt-0.5 text-xs text-muted">{q.body}</div>
          </Link>
        ))}
      </div>

      <Card
        className="mt-6"
        title="Active sessions"
        description="Clients connected right now, and how their profile was chosen."
        bodyClassName="overflow-x-auto"
      >
        {sessions.isPending ? (
          <div className="px-4">
            <Loading />
          </div>
        ) : !sessions.data?.length ? (
          <div className="p-4">
            <EmptyState
              title="No clients connected"
              action={
                <Link to="/clients" className="text-sm font-medium text-accent">
                  Connect a client →
                </Link>
              }
            >
              Sessions appear here as soon as an AI client opens a profile endpoint.
            </EmptyState>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-line">
              <tr>
                <th className={thClass}>Client</th>
                <th className={thClass}>Profile</th>
                <th className={thClass}>Resolved by</th>
                <th className={thClass}>Surface</th>
                <th className={thClass}>Connected</th>
                <th className={thClass}>Last seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {sessions.data.map((x) => (
                <tr key={x.id}>
                  <td className={tdClass}>
                    <span className="font-medium">{x.client?.name ?? 'unknown'}</span>
                    {x.client?.version && <span className="ml-1 text-xs text-faint">{x.client.version}</span>}
                  </td>
                  <td className={tdClass}>
                    <Link to={`/profiles/${x.profile}`} className="text-accent hover:underline">
                      {x.profile}
                    </Link>
                  </td>
                  <td className={tdClass}>
                    <Badge>{viaLabel(x.via)}</Badge>
                  </td>
                  <td className={tdClass}>
                    <InlineCode>{x.surface}</InlineCode>
                  </td>
                  <td className={`${tdClass} text-muted`}>{relativeTime(x.createdAt)}</td>
                  <td className={`${tdClass} text-muted`}>{relativeTime(x.lastSeenAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card className="mt-6" title="Daemon" bodyClassName="p-0">
        <dl className="grid grid-cols-1 divide-y divide-line text-sm sm:grid-cols-[180px_1fr] sm:divide-y-0">
          {[
            ['State directory', s.home],
            ['Config file', s.configPath],
            ['Secrets backend', s.secretsBackend],
          ].map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="px-4 pt-3 text-xs text-muted sm:py-2.5">{k}</dt>
              <dd className="truncate px-4 pb-3 font-mono text-xs sm:py-2.5">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </>
  )
}
