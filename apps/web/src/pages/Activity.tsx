import { useMemo } from 'react'
import { useAudit, useConfig } from '../lib/queries.ts'
import { navigate, useLocation } from '../lib/router.tsx'
import {
  Badge,
  duration,
  EmptyState,
  ErrorBox,
  inputClass,
  Loading,
  PageHeader,
  relativeTime,
  tdClass,
  thClass,
  useTick,
} from '../lib/ui.tsx'

const VIA_LABEL: Record<string, string> = { direct: 'direct', call_tool: 'call_tool', code: 'code mode' }

export function ActivityPage() {
  useTick(10_000)
  const audit = useAudit()
  const config = useConfig()
  const { query } = useLocation()
  const profile = query.get('profile') ?? ''
  const errorsOnly = query.get('errors') === '1'

  const setFilter = (key: string, value: string) => {
    const q = new URLSearchParams(query)
    if (value) q.set(key, value)
    else q.delete(key)
    const s = q.toString()
    navigate(`/activity${s ? `?${s}` : ''}`, { replace: true })
  }

  const rows = useMemo(
    () => (audit.data ?? []).filter((e) => (!profile || e.profile === profile) && (!errorsOnly || !e.ok)),
    [audit.data, profile, errorsOnly],
  )
  const profiles = Object.keys(config.data?.profiles ?? {})
  const errors = rows.filter((r) => !r.ok).length

  return (
    <>
      <PageHeader
        title="Activity"
        description="Tool calls through Switchboard, newest first, updated live. Arguments and results are never recorded."
        actions={
          <>
            <label className="flex items-center gap-1.5 text-sm text-muted">
              <input
                type="checkbox"
                className="size-4 accent-[var(--sb-accent)]"
                checked={errorsOnly}
                onChange={(e) => setFilter('errors', e.target.checked ? '1' : '')}
              />
              Errors only
            </label>
            <select
              aria-label="Filter by profile"
              className={`${inputClass} w-44`}
              value={profile}
              onChange={(e) => setFilter('profile', e.target.value)}
            >
              <option value="">All profiles</option>
              {profiles.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </>
        }
      />
      {audit.isPending ? (
        <Loading />
      ) : audit.error ? (
        <ErrorBox error={audit.error} />
      ) : !rows.length ? (
        <EmptyState title={audit.data.length ? 'No calls match these filters' : 'No tool calls yet'}>
          {audit.data.length
            ? 'Clear the filters to see everything.'
            : 'Connect a client to a profile and use a tool; each call shows up here as it happens.'}
        </EmptyState>
      ) : (
        <>
          <p className="mb-2 text-xs text-muted">
            {rows.length} call{rows.length === 1 ? '' : 's'}
            {errors > 0 && <span className="text-bad"> · {errors} failed</span>}
          </p>
          <div className="overflow-x-auto rounded-lg border border-line bg-panel shadow-xs">
            <table className="w-full text-sm">
              <thead className="border-b border-line">
                <tr>
                  <th className={thClass}>Time</th>
                  <th className={thClass}>Client</th>
                  <th className={thClass}>Profile</th>
                  <th className={thClass}>Tool</th>
                  <th className={thClass}>Via</th>
                  <th className={`${thClass} text-right`}>Duration</th>
                  <th className={thClass}>Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((e, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: audit events have no id
                  <tr key={`${e.ts}-${i}`} className="hover:bg-subtle/60">
                    <td
                      className={`${tdClass} whitespace-nowrap text-muted`}
                      title={new Date(e.ts).toLocaleString()}
                    >
                      {new Date(e.ts).toLocaleTimeString()}
                      <span className="ml-1.5 text-xs text-faint">{relativeTime(e.ts)}</span>
                    </td>
                    <td className={tdClass}>{e.client ?? <span className="text-faint">—</span>}</td>
                    <td className={tdClass}>
                      <button
                        type="button"
                        className="hover:text-accent"
                        onClick={() => setFilter('profile', e.profile)}
                        title={`Show only ${e.profile}`}
                      >
                        {e.profile}
                      </button>
                    </td>
                    <td className={`${tdClass} font-mono text-xs`}>{e.tool}</td>
                    <td className={tdClass}>
                      <Badge>{VIA_LABEL[e.via] ?? e.via}</Badge>
                    </td>
                    <td className={`${tdClass} text-right whitespace-nowrap tabular-nums`}>
                      {duration(e.durationMs)}
                    </td>
                    <td className={tdClass}>
                      {e.ok ? (
                        <Badge tone="ok">ok</Badge>
                      ) : (
                        <span className="flex flex-col items-start gap-0.5">
                          <Badge tone="bad">error</Badge>
                          {e.error && (
                            <span className="line-clamp-2 max-w-xs text-xs text-bad" title={e.error}>
                              {e.error}
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )
}
