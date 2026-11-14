import type { AuditEvent } from './audit.ts'

export const RANGES = {
  '1h': { durationMs: 60 * 60_000, bucketMs: 60_000 },
  '24h': { durationMs: 24 * 60 * 60_000, bucketMs: 15 * 60_000 },
  '7d': { durationMs: 7 * 24 * 60 * 60_000, bucketMs: 2 * 60 * 60_000 },
  '30d': { durationMs: 30 * 24 * 60 * 60_000, bucketMs: 12 * 60 * 60_000 },
} as const
export type Range = keyof typeof RANGES

export interface Stats {
  range: Range
  bucketMs: number
  source: 'file' | 'memory'
  totals: { calls: number; errors: number; p50: number; p95: number }
  buckets: { t: number; calls: number; errors: number; p50: number; p95: number }[]
  tools: { tool: string; server: string; calls: number; errors: number; avgMs: number }[]
  servers: { server: string; calls: number; errors: number }[]
  clients: { client: string; calls: number }[]
  profiles: { profile: string; calls: number }[]
}

export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[i]!
}

function top<T extends { calls: number }>(map: Map<string, T>, limit: number): T[] {
  return [...map.values()].sort((a, b) => b.calls - a.calls).slice(0, limit)
}

/** Aggregate tool calls into time buckets and breakdowns for the activity charts. */
export function computeStats(
  events: AuditEvent[],
  range: Range,
  source: 'file' | 'memory',
  now = Date.now(),
): Stats {
  const { durationMs, bucketMs } = RANGES[range]
  const end = Math.floor(now / bucketMs) * bucketMs + bucketMs
  const start = end - Math.ceil(durationMs / bucketMs) * bucketMs
  const buckets = new Map<number, number[]>()
  const bucketErrors = new Map<number, number>()
  for (let t = start; t < end; t += bucketMs) {
    buckets.set(t, [])
    bucketErrors.set(t, 0)
  }
  const tools = new Map<string, Stats['tools'][number] & { totalMs: number }>()
  const servers = new Map<string, Stats['servers'][number]>()
  const clients = new Map<string, Stats['clients'][number]>()
  const profiles = new Map<string, Stats['profiles'][number]>()
  const all: number[] = []
  let errors = 0

  for (const e of events) {
    const ts = Date.parse(e.ts)
    if (ts < start || ts >= end) continue
    const t = Math.floor(ts / bucketMs) * bucketMs
    buckets.get(t)?.push(e.durationMs)
    if (!e.ok) {
      errors++
      bucketErrors.set(t, (bucketErrors.get(t) ?? 0) + 1)
    }
    all.push(e.durationMs)
    const server = e.server ?? (e.tool.includes('.') ? e.tool.slice(0, e.tool.indexOf('.')) : '-')
    const tool = tools.get(e.tool) ?? { tool: e.tool, server, calls: 0, errors: 0, avgMs: 0, totalMs: 0 }
    tool.calls++
    tool.totalMs += e.durationMs
    if (!e.ok) tool.errors++
    tools.set(e.tool, tool)
    const s = servers.get(server) ?? { server, calls: 0, errors: 0 }
    s.calls++
    if (!e.ok) s.errors++
    servers.set(server, s)
    const clientName = e.client ?? 'unknown'
    const c = clients.get(clientName) ?? { client: clientName, calls: 0 }
    c.calls++
    clients.set(clientName, c)
    const p = profiles.get(e.profile) ?? { profile: e.profile, calls: 0 }
    p.calls++
    profiles.set(e.profile, p)
  }

  all.sort((a, b) => a - b)
  return {
    range,
    bucketMs,
    source,
    totals: { calls: all.length, errors, p50: percentile(all, 50), p95: percentile(all, 95) },
    buckets: [...buckets].map(([t, durations]) => {
      durations.sort((a, b) => a - b)
      return {
        t,
        calls: durations.length,
        errors: bucketErrors.get(t) ?? 0,
        p50: percentile(durations, 50),
        p95: percentile(durations, 95),
      }
    }),
    tools: top(tools, 15).map(({ totalMs, ...t }) => ({ ...t, avgMs: Math.round(totalMs / t.calls) })),
    servers: top(servers, 20),
    clients: top(clients, 20),
    profiles: top(profiles, 20),
  }
}
