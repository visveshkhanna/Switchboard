import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, describe, expect, it } from 'vitest'
import { startDaemon, stdioServer, type TestDaemon, text, waitFor } from './helpers.ts'

const baseConfig = {
  servers: { alpha: stdioServer('alpha'), beta: stdioServer('beta') },
  profiles: {
    personal: { servers: ['alpha'], surface: 'passthrough' as const },
    work: {
      servers: ['beta'],
      include: ['alpha.echo'],
      exclude: ['beta.fail', 'beta.grow'],
      surface: 'passthrough' as const,
    },
  },
  clientRules: [{ client: 'cursor*', profile: 'work' }],
}

let t: TestDaemon
afterEach(async () => {
  await t?.close()
})

const names = (tools: { name: string }[]) => tools.map((x) => x.name).sort()

describe('profiles over HTTP', () => {
  it('serves a profile from the URL path', async () => {
    t = await startDaemon(baseConfig)
    const { client } = await t.connect('/p/personal/mcp')
    const { tools } = await client.listTools()
    expect(names(tools)).toEqual([
      'alpha__add',
      'alpha__echo',
      'alpha__fail',
      'alpha__grow',
      'alpha__pid',
      'alpha__sleep',
    ])
    const result = await client.callTool({ name: 'alpha__add', arguments: { a: 2, b: 3 } })
    expect(text(result)).toBe('5')
    expect(result.structuredContent).toEqual({ sum: 5 })
    expect(client.getInstructions()).toContain('Instructions for alpha.')
  })

  it('applies include and exclude and picks the profile from the header', async () => {
    t = await startDaemon(baseConfig)
    const { client } = await t.connect('/mcp', { headers: { 'x-switchboard-profile': 'work' } })
    const { tools } = await client.listTools()
    expect(names(tools)).toEqual(['alpha__echo', 'beta__add', 'beta__echo', 'beta__pid', 'beta__sleep'])
    expect(text(await client.callTool({ name: 'alpha__echo', arguments: { text: 'hi' } }))).toBe('alpha:hi')
  })

  it('picks the profile from the client name', async () => {
    t = await startDaemon(baseConfig)
    const { client } = await t.connect('/mcp', { clientName: 'cursor-vscode' })
    const { tools } = await client.listTools()
    expect(names(tools)).toContain('beta__echo')
    expect(t.daemon.sessions.list()[0]).toMatchObject({ profile: 'work', via: 'client-rule' })
  })

  it('refuses unknown profiles named in the URL', async () => {
    t = await startDaemon(baseConfig)
    await expect(t.connect('/p/nope/mcp')).rejects.toThrow(/Unknown Switchboard profile .*nope/)
  })

  it('falls back to the default profile', async () => {
    t = await startDaemon({ ...baseConfig, defaultProfile: 'personal' })
    const { client } = await t.connect('/mcp')
    expect(names((await client.listTools()).tools)).toContain('alpha__pid')
  })

  it('never calls a tool outside the profile', async () => {
    t = await startDaemon(baseConfig)
    const { client } = await t.connect('/p/personal/mcp')
    const result = await client.callTool({ name: 'beta__echo', arguments: { text: 'x' } })
    expect(result.isError).toBe(true)
    const excluded = await (await t.connect('/p/work/mcp')).client.callTool({ name: 'beta__fail' })
    expect(excluded.isError).toBe(true)
    expect(text(excluded)).toMatch(/Unknown tool/)
  })

  it('shares one upstream process between sessions', async () => {
    t = await startDaemon(baseConfig)
    const a = await t.connect('/p/personal/mcp')
    const b = await t.connect('/p/personal/mcp')
    const pidA = text(await a.client.callTool({ name: 'alpha__pid' }))
    const pidB = text(await b.client.callTool({ name: 'alpha__pid' }))
    expect(pidA).toBe(pidB)
    expect(t.daemon.sessions.list()).toHaveLength(2)
  })

  it('serves tools/list from the catalog without starting servers', async () => {
    t = await startDaemon(baseConfig)
    const first = await t.connect('/p/personal/mcp')
    await first.client.listTools()
    await t.daemon.upstream.stopAll()
    expect(t.daemon.upstream.get('alpha')!.state).toBe('stopped')
    const second = await t.connect('/p/personal/mcp')
    const started = performance.now()
    await second.client.listTools()
    expect(performance.now() - started).toBeLessThan(200)
    expect(t.daemon.upstream.get('alpha')!.state).toBe('stopped')
  })

  it('notifies clients when a profile changes', async () => {
    t = await startDaemon(baseConfig)
    const { client } = await t.connect('/p/personal/mcp')
    await client.listTools()
    let notified = 0
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      notified++
    })
    await t.daemon.config.update((c) => {
      c.profiles.personal!.exclude = ['alpha.fail']
      return c
    })
    await waitFor(() => notified > 0)
    expect(names((await client.listTools()).tools)).not.toContain('alpha__fail')
  })

  it('follows tools/list_changed from upstream servers', async () => {
    t = await startDaemon(baseConfig)
    const { client } = await t.connect('/p/personal/mcp')
    await client.listTools()
    let notified = 0
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      notified++
    })
    await client.callTool({ name: 'alpha__grow' })
    await waitFor(() => notified > 0)
    expect(names((await client.listTools()).tools)).toContain('alpha__extra_1')
  })

  it('records calls in the audit log without arguments', async () => {
    t = await startDaemon(baseConfig)
    const { client } = await t.connect('/p/personal/mcp')
    await client.callTool({ name: 'alpha__echo', arguments: { text: 'secret' } })
    const [event] = t.daemon.audit.recent()
    expect(event).toMatchObject({ profile: 'personal', tool: 'alpha.echo', ok: true, via: 'direct' })
    expect(JSON.stringify(event)).not.toContain('secret')
  })

  it('rejects requests for other hosts and origins', async () => {
    t = await startDaemon(baseConfig)
    const res = await fetch(`${t.url}/healthz`, { headers: { origin: 'https://evil.example' } })
    expect(res.status).toBe(403)
    expect((await fetch(`${t.url}/healthz`)).status).toBe(200)
  })
})
