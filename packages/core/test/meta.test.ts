import { afterEach, describe, expect, it } from 'vitest'
import { startDaemon, stdioServer, type TestDaemon, text } from './helpers.ts'

let t: TestDaemon
afterEach(async () => {
  await t?.close()
})

const config = {
  servers: { alpha: stdioServer('alpha'), beta: stdioServer('beta') },
  profiles: {
    meta: { servers: ['alpha', 'beta'], exclude: ['beta.fail'], surface: 'meta' as const },
    auto: { servers: ['alpha', 'beta'], autoThreshold: 5 },
    small: { servers: ['alpha'], autoThreshold: 50 },
  },
}

describe('meta surface', () => {
  it('lists three tools and finds, describes and calls the rest', async () => {
    t = await startDaemon(config)
    const { client } = await t.connect('/p/meta/mcp')
    const { tools } = await client.listTools()
    expect(tools.map((x) => x.name)).toEqual(['search_tools', 'get_schema', 'call_tool'])
    expect(tools[0]?.description).toContain('alpha (6 tools), beta (5 tools)')

    const found = text(await client.callTool({ name: 'search_tools', arguments: { query: 'add numbers' } }))
    expect(found.split('\n')[0]).toMatch(/^(alpha|beta)\.add - Add two numbers/)

    const schema = text(await client.callTool({ name: 'get_schema', arguments: { names: ['alpha.add'] } }))
    expect(schema).toContain('alpha.add(input: {')
    expect(schema).toContain('a: number;')

    const sum = await client.callTool({
      name: 'call_tool',
      arguments: { name: 'alpha.add', arguments: { a: 1, b: 2 } },
    })
    expect(text(sum)).toBe('3')
    expect(t.daemon.audit.recent()[0]).toMatchObject({ tool: 'alpha.add', via: 'call_tool' })
  })

  it('lists a server’s tools when searching for its name', async () => {
    t = await startDaemon(config)
    const { client } = await t.connect('/p/meta/mcp')
    const found = text(await client.callTool({ name: 'search_tools', arguments: { query: 'beta' } }))
    expect(found.split('\n')).toHaveLength(5)
  })

  it('cannot reach excluded tools', async () => {
    t = await startDaemon(config)
    const { client } = await t.connect('/p/meta/mcp')
    const result = await client.callTool({ name: 'call_tool', arguments: { name: 'beta.fail' } })
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/Unknown tool/)
  })

  it('switches automatically on tool count', async () => {
    t = await startDaemon(config)
    const auto = await t.connect('/p/auto/mcp')
    expect((await auto.client.listTools()).tools).toHaveLength(3)
    const small = await t.connect('/p/small/mcp')
    expect((await small.client.listTools()).tools).toHaveLength(6)
  })

  it('uses far less context than passthrough for the same tools', async () => {
    t = await startDaemon({
      ...config,
      profiles: { ...config.profiles, all: { servers: ['alpha', 'beta'], surface: 'passthrough' as const } },
    })
    const meta = JSON.stringify((await (await t.connect('/p/meta/mcp')).client.listTools()).tools)
    const all = JSON.stringify((await (await t.connect('/p/all/mcp')).client.listTools()).tools)
    expect(meta.length).toBeLessThan(all.length)
  })
})
