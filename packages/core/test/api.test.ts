import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startDaemon, stdioServer, type TestDaemon } from './helpers.ts'

let t: TestDaemon
afterEach(async () => {
  await t?.close()
})

async function api(path: string, init: RequestInit & { json?: unknown } = {}, token = t.daemon.adminToken) {
  const res = await fetch(`${t.url}/api${path}`, {
    ...init,
    body: init.json === undefined ? init.body : JSON.stringify(init.json),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  })
  return { status: res.status, body: (await res.json()) as any }
}

describe('admin API', () => {
  it('requires the admin token', async () => {
    t = await startDaemon({})
    expect((await api('/status', {}, 'wrong')).status).toBe(401)
    expect((await api('/status')).body.name).toBe('switchboard')
  })

  it('manages servers and profiles and previews what a client sees', async () => {
    t = await startDaemon({})
    expect((await api('/servers/alpha', { method: 'PUT', json: stdioServer('alpha') })).status).toBe(200)
    const bad = await api('/profiles/work', { method: 'PUT', json: { servers: ['ghost'] } })
    expect(bad.status).toBe(400)
    expect(bad.body.problems[0]).toMatch(/unknown server "ghost"/)

    expect((await api('/profiles/work', { method: 'PUT', json: { servers: ['alpha'] } })).status).toBe(200)
    const preview = await api('/profiles/work/preview', {
      method: 'POST',
      json: { servers: ['alpha'], surface: 'meta' },
    })
    expect(preview.body.surface).toBe('meta')
    expect(preview.body.listed).toEqual(['search_tools', 'get_schema', 'call_tool'])
    expect(preview.body.tools).toHaveLength(6)
    expect(preview.body.tokens.listed).toBeGreaterThan(0)

    const test = await api('/servers/alpha/test', { method: 'POST' })
    expect(test.body.ok).toBe(true)

    await api('/servers/alpha', { method: 'DELETE' })
    expect((await api('/config')).body.profiles.work.servers).toEqual([])
  })

  it('connects clients and imports their servers', async () => {
    const clientHome = join(process.env.TMPDIR ?? '/tmp', `sb-clients-${process.pid}-${Date.now()}`)
    await mkdir(join(clientHome, '.cursor'), { recursive: true })
    await writeFile(
      join(clientHome, '.cursor', 'mcp.json'),
      JSON.stringify({ mcpServers: { github: { command: 'npx', args: ['gh'] } } }),
    )
    t = await startDaemon({ profiles: { work: {} } }, { clientEnv: { home: clientHome, platform: 'linux' } })
    const candidates = await api('/import')
    expect(candidates.body).toMatchObject([{ client: 'cursor', name: 'github', exists: false }])
    await api('/import', {
      method: 'POST',
      json: { items: [{ name: 'github', server: candidates.body[0].server }] },
    })
    expect((await api('/config')).body.servers.github.command).toBe('npx')

    const connected = await api('/clients/cursor/connect', { method: 'POST', json: { profile: 'work' } })
    expect(connected.body.ok).toBe(true)
    const file = JSON.parse(await readFile(join(clientHome, '.cursor', 'mcp.json'), 'utf8'))
    expect(file.mcpServers.switchboard.url).toMatch(/\/p\/work\/mcp$/)
    const clients = await api('/clients')
    expect(clients.body.find((c: any) => c.id === 'cursor').connectedProfile).toBe('work')
  })

  it('stores secrets without ever returning their values', async () => {
    t = await startDaemon({})
    await api('/secrets/github-token', { method: 'PUT', json: { value: 'ghp_secret' } })
    const list = await api('/secrets')
    expect(list.body.names).toEqual(['github-token'])
    expect(JSON.stringify(list.body)).not.toContain('ghp_secret')
  })
})
