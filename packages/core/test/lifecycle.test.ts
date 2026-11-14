import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, describe, expect, it } from 'vitest'
import { startDaemon, stdioServer, type TestDaemon, text, waitFor } from './helpers.ts'

let t: TestDaemon
afterEach(async () => {
  await t?.close()
})

describe('server lifecycle', () => {
  it('serves a server added to a profile that a client is already using', async () => {
    t = await startDaemon({
      servers: { alpha: stdioServer('alpha'), beta: stdioServer('beta') },
      profiles: { work: { servers: ['alpha'], surface: 'passthrough' } },
    })
    const { client } = await t.connect('/p/work/mcp')
    await client.listTools()
    let notified = 0
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      notified++
    })
    await t.daemon.config.update((c) => {
      c.profiles.work!.servers = ['alpha', 'beta']
      return c
    })
    await waitFor(() => notified > 0, 10_000)
    const { tools } = await client.listTools()
    expect(tools.map((x) => x.name)).toContain('beta__echo')
    expect(text(await client.callTool({ name: 'beta__echo', arguments: { text: 'hi' } }))).toBe('beta:hi')
  })

  it('discovers the tools of a server as soon as it is added', async () => {
    t = await startDaemon({})
    await t.daemon.config.update((c) => {
      c.servers.alpha = {
        ...stdioServer('alpha'),
        enabled: true,
        args: stdioServer('alpha').args,
        env: {},
        idleTimeoutSec: 600,
        callTimeoutSec: 120,
      }
      return c
    })
    await waitFor(() => (t.daemon.catalog.get('alpha')?.tools.length ?? 0) > 0, 10_000)
  })

  it('restarts a server that crashes', async () => {
    t = await startDaemon({
      servers: { alpha: stdioServer('alpha') },
      profiles: { work: { servers: ['alpha'], surface: 'passthrough' } },
    })
    const { client } = await t.connect('/p/work/mcp')
    const pid = Number(text(await client.callTool({ name: 'alpha__pid' })))
    process.kill(pid, 'SIGKILL')
    const connection = t.daemon.upstream.get('alpha')!
    await waitFor(() => connection.status().restarts > 0 && connection.state === 'ready', 10_000)
    const next = Number(text(await client.callTool({ name: 'alpha__pid' })))
    expect(next).not.toBe(pid)
  })

  it('keeps servers with idleTimeoutSec 0 running from the start', async () => {
    t = await startDaemon({ servers: { alpha: { ...stdioServer('alpha'), idleTimeoutSec: 0 } } })
    await waitFor(() => t.daemon.upstream.get('alpha')!.state === 'ready', 10_000)
  })
})
