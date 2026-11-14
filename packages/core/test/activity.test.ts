import { mkdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { computeStats } from '../src/stats.ts'
import { startDaemon, stdioServer, type TestDaemon } from './helpers.ts'

let t: TestDaemon
afterEach(async () => {
  await t?.close()
})

async function api(path: string, init: { method?: string; json?: unknown } = {}) {
  const res = await fetch(`${t.url}/api${path}`, {
    method: init.method ?? 'GET',
    body: init.json === undefined ? undefined : JSON.stringify(init.json),
    headers: { authorization: `Bearer ${t.daemon.adminToken}`, 'content-type': 'application/json' },
  })
  return { status: res.status, body: (await res.json()) as any }
}

const config = {
  servers: { alpha: stdioServer('alpha') },
  profiles: { work: { servers: ['alpha'], surface: 'passthrough' as const } },
}

describe('activity log', () => {
  it('asks first, and writes to disk only when turned on', async () => {
    t = await startDaemon(config)
    expect((await api('/settings')).body).toEqual({ activityLog: null, retentionDays: 30 })
    const { client } = await t.connect('/p/work/mcp')
    await client.callTool({ name: 'alpha__echo', arguments: { text: 'a' } })
    await t.daemon.audit.flush()
    await expect(stat(join(t.home, 'audit.jsonl'))).rejects.toThrow()

    expect((await api('/settings', { method: 'PUT', json: { activityLog: true } })).body.activityLog).toBe(
      true,
    )
    await client.callTool({ name: 'alpha__add', arguments: { a: 1, b: 2 } })
    await client.callTool({ name: 'alpha__fail' })
    await t.daemon.audit.flush()
    const lines = (await readFile(join(t.home, 'audit.jsonl'), 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]!)).toMatchObject({
      tool: 'alpha.add',
      server: 'alpha',
      client: 'vitest',
      ok: true,
    })

    const stats = await api('/stats?range=1h')
    expect(stats.body).toMatchObject({ source: 'file', totals: { calls: 2, errors: 1 } })
    expect(stats.body.buckets).toHaveLength(60)
    expect(stats.body.tools.map((x: any) => x.tool).sort()).toEqual(['alpha.add', 'alpha.fail'])
    expect((await api('/stats?range=1y')).status).toBe(400)
  })
})

describe('computeStats', () => {
  it('buckets calls and computes percentiles', () => {
    const now = Date.UTC(2026, 0, 1, 12, 30)
    const ev = (minsAgo: number, ms: number, ok = true) => ({
      ts: new Date(now - minsAgo * 60_000).toISOString(),
      profile: 'p',
      tool: 's.t',
      via: 'direct' as const,
      durationMs: ms,
      ok,
    })
    const stats = computeStats([ev(1, 10), ev(1, 30), ev(5, 100, false), ev(120, 5)], '1h', 'memory', now)
    expect(stats.totals).toEqual({ calls: 3, errors: 1, p50: 30, p95: 100 })
    expect(stats.buckets.reduce((n, b) => n + b.calls, 0)).toBe(3)
    expect(stats.servers).toEqual([{ server: 's', calls: 3, errors: 1 }])
  })
})

describe('automatic client connection', () => {
  it('points a client at the shared endpoint', async () => {
    const clientHome = join(t?.home ?? process.env.TMPDIR ?? '/tmp', `auto-${Date.now()}`)
    await mkdir(clientHome, { recursive: true })
    t = await startDaemon(config, { clientEnv: { home: clientHome, platform: 'linux' } })
    const res = await api('/clients/cursor/connect', { method: 'POST', json: { profile: null } })
    expect(res.body.ok).toBe(true)
    const file = JSON.parse(await readFile(join(clientHome, '.cursor', 'mcp.json'), 'utf8'))
    expect(file.mcpServers.switchboard.url).toMatch(/127\.0\.0\.1:\d+\/mcp$/)
    const cursor = (await api('/clients')).body.find((c: any) => c.id === 'cursor')
    expect(cursor).toMatchObject({ connectedMode: 'auto', foreignEntry: false })
  })
})
