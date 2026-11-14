import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, describe, expect, it } from 'vitest'
import { startDaemon, stdioServer, type TestDaemon, text, waitFor } from './helpers.ts'

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
  return { status: res.status, body: (await res.json()) as unknown }
}

const config = {
  servers: { alpha: stdioServer('alpha') },
  profiles: {
    work: { servers: ['alpha'], surface: 'passthrough' as const },
    other: { servers: ['alpha'], exclude: ['alpha.echo'], surface: 'passthrough' as const },
  },
}

describe('clients without a profile', () => {
  it('holds a new client with no tools until a profile is assigned, then switches it live', async () => {
    t = await startDaemon(config)
    const { client } = await t.connect('/mcp', { clientName: 'brand-new-ide' })
    expect((await client.listTools()).tools).toEqual([])
    expect(client.getInstructions()).toMatch(/no profile for this client \("brand-new-ide"\)/)
    const call = await client.callTool({ name: 'alpha__echo', arguments: { text: 'x' } })
    expect(call.isError).toBe(true)

    const seen = (await api('/seen-clients')).body as { name: string; waiting: number; lastVia: string }[]
    expect(seen).toMatchObject([{ name: 'brand-new-ide', waiting: 1, sessions: 1, lastVia: 'unassigned' }])

    let notified = 0
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      notified++
    })
    const assigned = await api('/seen-clients/brand-new-ide/profile', {
      method: 'PUT',
      json: { profile: 'work' },
    })
    expect(assigned.body).toMatchObject({ ruleProfile: 'work', waiting: 0 })
    await waitFor(() => notified > 0)
    expect((await client.listTools()).tools.map((x) => x.name)).toContain('alpha__echo')
    expect(text(await client.callTool({ name: 'alpha__echo', arguments: { text: 'hi' } }))).toBe('alpha:hi')
    expect(t.daemon.sessions.list()[0]).toMatchObject({ profile: 'work', via: 'client-rule' })
  })

  it('moves rule-matched sessions when their rule changes, but never pinned ones', async () => {
    t = await startDaemon({ ...config, clientRules: [{ client: 'ide*', profile: 'work' }] })
    const ruled = await t.connect('/mcp', { clientName: 'ide-one' })
    const pinned = await t.connect('/p/work/mcp', { clientName: 'ide-one' })
    expect((await ruled.client.listTools()).tools.map((x) => x.name)).toContain('alpha__echo')
    await api('/seen-clients/ide-one/profile', { method: 'PUT', json: { profile: 'other' } })
    await waitFor(() => t.daemon.sessions.list().some((s) => s.profile === 'other'))
    expect((await ruled.client.listTools()).tools.map((x) => x.name)).not.toContain('alpha__echo')
    expect((await pinned.client.listTools()).tools.map((x) => x.name)).toContain('alpha__echo')
    const rules = ((await api('/config')).body as { clientRules: unknown[] }).clientRules
    expect(rules[0]).toEqual({ client: 'ide-one', profile: 'other' })
  })

  it('remembers clients across restarts and can forget them', async () => {
    t = await startDaemon(config)
    await t.connect('/p/work/mcp', { clientName: 'remember-me' })
    await t.daemon.seen.flush()
    const { SeenClients } = await import('../src/seen-clients.ts')
    const reopened = await SeenClients.open(t.daemon.paths.seenClients)
    expect(reopened.list().map((c) => c.name)).toEqual(['remember-me'])
    expect((await api('/seen-clients/remember-me', { method: 'DELETE' })).body).toEqual({ ok: true })
    expect((await api('/seen-clients')).body).toEqual([])
  })
})
