import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, describe, expect, it } from 'vitest'
import { startDaemon, stdioServer, type TestDaemon, text, waitFor } from './helpers.ts'

let t: TestDaemon
afterEach(async () => {
  await t?.close()
})

// biome-ignore lint/suspicious/noExplicitAny: API responses in tests
type Json = any

async function api(path: string, init: { method?: string; json?: unknown } = {}) {
  const res = await fetch(`${t.url}/api${path}`, {
    method: init.method ?? 'GET',
    body: init.json === undefined ? undefined : JSON.stringify(init.json),
    headers: { authorization: `Bearer ${t.daemon.adminToken}`, 'content-type': 'application/json' },
  })
  return { status: res.status, body: (await res.json()) as Json }
}

const config = {
  servers: { alpha: stdioServer('alpha') },
  profiles: {
    work: { servers: ['alpha'], surface: 'passthrough' as const },
    other: { servers: ['alpha'], exclude: ['alpha.echo'], surface: 'passthrough' as const },
  },
  defaultProfile: 'work',
}

const toolNames = async (client: { listTools(): Promise<{ tools: { name: string }[] }> }) =>
  (await client.listTools()).tools.map((x) => x.name)

describe('per-client profiles', () => {
  it('gives a client on its own URL the default profile, and switches it live', async () => {
    t = await startDaemon(config)
    const { client } = await t.connect('/c/cursor/mcp', { clientName: 'cursor-vscode' })
    expect(await toolNames(client)).toContain('alpha__echo')
    expect(t.daemon.sessions.list()[0]).toMatchObject({ clientId: 'cursor', profile: 'work', via: 'default' })

    let notified = 0
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      notified++
    })
    const switched = await api('/clients/cursor/profile', { method: 'PUT', json: { profile: 'other' } })
    expect(switched.body).toMatchObject({
      selection: 'profile',
      effectiveProfile: 'other',
      via: 'client',
      sessions: 1,
    })
    await waitFor(() => notified > 0)
    expect(await toolNames(client)).not.toContain('alpha__echo')

    // Every profile off: no tools, and calls explain how to turn one on.
    await api('/clients/cursor/profile', { method: 'PUT', json: { profile: null } })
    await waitFor(() => t.daemon.sessions.list()[0]?.via === 'disabled')
    expect(await toolNames(client)).toEqual([])
    const call = await client.callTool({ name: 'alpha__add', arguments: { a: 1, b: 2 } })
    expect(text(call)).toMatch(/switched off for this client \("cursor"\)/)

    // Back to the default profile.
    const reset = await api('/clients/cursor/profile', { method: 'PUT', json: { useDefault: true } })
    expect(reset.body).toMatchObject({ selection: 'default', effectiveProfile: 'work', via: 'default' })
    await waitFor(() => t.daemon.sessions.list()[0]?.profile === 'work')
    expect(text(await client.callTool({ name: 'alpha__echo', arguments: { text: 'hi' } }))).toBe('alpha:hi')
    const saved = JSON.parse(await readFile(join(t.home, 'config.json'), 'utf8'))
    expect(saved.clients.cursor).toEqual({ name: 'cursor-vscode' })
  })

  it('lists unknown clients by their MCP name and lets them be switched too', async () => {
    t = await startDaemon({ ...config, defaultProfile: undefined })
    const { client } = await t.connect('/mcp', { clientName: 'Brand New IDE' })
    expect(await toolNames(client)).toEqual([])
    const row = (await api('/clients')).body.find((r: Json) => r.id === 'brand-new-ide')
    expect(row).toMatchObject({ name: 'Brand New IDE', via: 'unassigned', waiting: 1, preset: null })

    await api('/clients/brand-new-ide/profile', { method: 'PUT', json: { profile: 'work' } })
    await waitFor(() => t.daemon.sessions.list()[0]?.profile === 'work')
    expect(await toolNames(client)).toContain('alpha__echo')
  })

  it('never moves sessions pinned by URL path', async () => {
    t = await startDaemon(config)
    const pinned = await t.connect('/p/work/mcp', { clientName: 'cursor-vscode' })
    await api('/clients/cursor-vscode/profile', { method: 'PUT', json: { profile: 'other' } })
    await new Promise((r) => setTimeout(r, 200))
    expect(await toolNames(pinned.client)).toContain('alpha__echo')
  })

  it('makes the first profile the default', async () => {
    t = await startDaemon({ servers: { alpha: stdioServer('alpha') } })
    await api('/profiles/personal', { method: 'PUT', json: { servers: ['alpha'] } })
    await api('/profiles/work', { method: 'PUT', json: { servers: ['alpha'] } })
    expect((await api('/config')).body.defaultProfile).toBe('personal')
    await api('/profiles/personal', { method: 'DELETE' })
    expect((await api('/config')).body.defaultProfile).toBe('work')
  })

  it('sets a client up with its own URL, once', async () => {
    const clientHome = join(process.env.TMPDIR ?? '/tmp', `sb-managed-${process.pid}-${Date.now()}`)
    await mkdir(clientHome, { recursive: true })
    t = await startDaemon(config, { clientEnv: { home: clientHome, platform: 'linux' } })
    expect((await api('/clients/cursor/connect', { method: 'POST', json: {} })).body.ok).toBe(true)
    const file = JSON.parse(await readFile(join(clientHome, '.cursor', 'mcp.json'), 'utf8'))
    expect(file.mcpServers.switchboard.url).toMatch(/\/c\/cursor\/mcp$/)
    const cursor = (await api('/clients')).body.find((r: Json) => r.id === 'cursor')
    expect(cursor.preset).toMatchObject({ setup: 'managed', managedId: 'cursor' })
  })

  it('remembers clients across restarts and can forget them', async () => {
    t = await startDaemon(config)
    const { client, transport } = await t.connect('/mcp', { clientName: 'remember-me' })
    await api('/clients/remember-me/profile', { method: 'PUT', json: { profile: 'other' } })
    // A client that is still connected would be listed again at once.
    await transport.terminateSession()
    await client.close()
    await waitFor(() => t.daemon.sessions.list().length === 0)
    await t.daemon.seen.flush()
    const { SeenClients } = await import('../src/seen-clients.ts')
    const reopened = await SeenClients.open(t.daemon.paths.seenClients)
    expect(reopened.list().map((c) => c.id)).toEqual(['remember-me'])
    await api('/clients/remember-me', { method: 'DELETE' })
    const ids = (await api('/clients')).body.map((r: Json) => r.id)
    expect(ids).not.toContain('remember-me')
    expect((await api('/config')).body.clients['remember-me']).toBeUndefined()
  })

  it('records clients that never send notifications/initialized', async () => {
    t = await startDaemon(config)
    const res = await fetch(`${t.url}/c/raw-client/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'raw', version: '1' },
        },
      }),
    })
    expect(res.status).toBe(200)
    await res.body?.cancel()
    expect((await api('/clients')).body.find((r: Json) => r.id === 'raw-client')).toMatchObject({
      sessions: 1,
    })
  })
})
