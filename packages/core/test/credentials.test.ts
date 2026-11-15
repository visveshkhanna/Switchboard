import { afterEach, describe, expect, it } from 'vitest'
import { stdioServer as fixture, fixtureServer, startDaemon, type TestDaemon, text } from './helpers.ts'

const stdioServer = (name: string, extra: Record<string, unknown> = {}) =>
  fixture(name, { args: [fixtureServer, name, '--env-tool'], ...extra })

let t: TestDaemon
afterEach(async () => {
  await t?.close()
})

const env = async (client: Awaited<ReturnType<TestDaemon['connect']>>['client'], key = 'TOKEN') =>
  text(await client.callTool({ name: 'alpha__env', arguments: { key } }))

describe('per-profile credentials', () => {
  it('runs each account as its own process with its own key', async () => {
    t = await startDaemon({
      servers: { alpha: stdioServer('alpha', { env: { SHARED: 'yes' } }) },
      profiles: {
        work: {
          servers: ['alpha'],
          surface: 'passthrough',
          credentials: { alpha: { env: { TOKEN: 'secret://work-token' } } },
        },
        personal: {
          servers: ['alpha'],
          surface: 'passthrough',
          credentials: { alpha: { env: { TOKEN: 'secret://me-token' } } },
        },
        oss: { servers: ['alpha'], surface: 'passthrough' },
      },
    })
    await t.daemon.secrets.set('work-token', 'w-123')
    await t.daemon.secrets.set('me-token', 'p-456')
    const work = (await t.connect('/p/work/mcp')).client
    const personal = (await t.connect('/p/personal/mcp')).client
    const oss = (await t.connect('/p/oss/mcp')).client

    expect(await env(work)).toBe('w-123')
    expect(await env(personal)).toBe('p-456')
    expect(await env(oss)).toBe('')
    // The server's own env reaches every account.
    expect(await env(work, 'SHARED')).toBe('yes')

    const pids = await Promise.all(
      [work, personal, oss].map(async (c) => text(await c.callTool({ name: 'alpha__pid', arguments: {} }))),
    )
    expect(new Set(pids).size).toBe(3)
    // Tool names are the same whichever account serves them.
    expect((await work.listTools()).tools.map((x) => x.name)).toContain('alpha__env')
    expect(
      t.daemon.upstream
        .statuses()
        .map((s) => [s.name, s.server, s.account])
        .sort(),
    ).toEqual([
      ['alpha', 'alpha', null],
      ['alpha.personal', 'alpha', 'personal'],
      ['alpha.work', 'alpha', 'work'],
    ])
  })

  it('shares one process between profiles that name the same account', async () => {
    const credentials = { alpha: { account: 'acme', env: { TOKEN: 'acme' } } }
    t = await startDaemon({
      servers: { alpha: stdioServer('alpha') },
      profiles: {
        a: { servers: ['alpha'], surface: 'passthrough', credentials },
        b: { servers: ['alpha'], surface: 'passthrough', credentials },
      },
    })
    const a = (await t.connect('/p/a/mcp')).client
    const b = (await t.connect('/p/b/mcp')).client
    const pid = async (c: typeof a) => text(await c.callTool({ name: 'alpha__pid', arguments: {} }))
    expect(await pid(a)).toBe(await pid(b))
    expect(await env(b)).toBe('acme')
    expect(t.daemon.upstream.statuses().map((s) => s.name)).toEqual(['alpha.acme'])
  })

  it('moves a client to the new account when its profile changes', async () => {
    t = await startDaemon({
      servers: { alpha: stdioServer('alpha') },
      profiles: {
        work: { servers: ['alpha'], surface: 'passthrough', credentials: { alpha: { env: { TOKEN: 'w' } } } },
        personal: {
          servers: ['alpha'],
          surface: 'passthrough',
          credentials: { alpha: { env: { TOKEN: 'p' } } },
        },
      },
      clients: { cursor: { profile: 'work' } },
    })
    const { client } = await t.connect('/c/cursor/mcp')
    expect(await env(client)).toBe('w')
    await t.daemon.config.update((draft) => {
      draft.clients.cursor!.profile = 'personal'
      return draft
    })
    expect(await env(client)).toBe('p')
  })

  it('restarts only the account whose credentials changed', async () => {
    t = await startDaemon({
      servers: { alpha: stdioServer('alpha') },
      profiles: {
        work: {
          servers: ['alpha'],
          surface: 'passthrough',
          credentials: { alpha: { env: { TOKEN: 'w1' } } },
        },
        oss: { servers: ['alpha'], surface: 'passthrough' },
      },
    })
    const work = (await t.connect('/p/work/mcp')).client
    const oss = (await t.connect('/p/oss/mcp')).client
    const pid = async (c: typeof work) => text(await c.callTool({ name: 'alpha__pid', arguments: {} }))
    const ossPid = await pid(oss)
    expect(await env(work)).toBe('w1')
    await t.daemon.config.update((draft) => {
      draft.profiles.work!.credentials.alpha!.env.TOKEN = 'w2'
      return draft
    })
    expect(await env(work)).toBe('w2')
    expect(await pid(oss)).toBe(ossPid)
  })

  it('lists accounts per server in the API', async () => {
    t = await startDaemon({
      servers: { alpha: stdioServer('alpha') },
      profiles: {
        work: { servers: ['alpha'], credentials: { alpha: { env: { TOKEN: 'w' } } } },
        oss: { servers: ['alpha'] },
      },
    })
    const headers = { authorization: `Bearer ${t.daemon.adminToken}` }
    const rows = (await (await fetch(`${t.url}/api/servers`, { headers })).json()) as {
      name: string
      instances: { id: string; account: string | null; profiles: string[] }[]
    }[]
    expect(rows[0]!.instances.map(({ id, account, profiles }) => ({ id, account, profiles }))).toEqual([
      { id: 'alpha', account: null, profiles: ['oss'] },
      { id: 'alpha.work', account: 'work', profiles: ['work'] },
    ])
    const tools = (await (
      await fetch(`${t.url}/api/servers/alpha.work/test`, { method: 'POST', headers })
    ).json()) as { ok: boolean }
    expect(tools.ok).toBe(true)
  })
})
