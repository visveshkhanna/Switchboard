import { afterEach, describe, expect, it } from 'vitest'
import { startDaemon, stdioServer, type TestDaemon, text } from './helpers.ts'

let t: TestDaemon
afterEach(async () => {
  await t?.close()
})

const config = {
  servers: { alpha: stdioServer('alpha'), 'beta-2': stdioServer('beta') },
  profiles: {
    code: {
      servers: ['alpha', 'beta-2'],
      exclude: ['beta-2.fail'],
      surface: 'code' as const,
      budgets: { timeoutMs: 3000, maxToolCalls: 5 },
    },
  },
}

const run = async (code: string) => {
  const { client } = await t.connect('/p/code/mcp')
  return client.callTool({ name: 'execute', arguments: { code } })
}

describe('code surface', () => {
  it('describes the tools as TypeScript in one execute tool', async () => {
    t = await startDaemon(config)
    const { client } = await t.connect('/p/code/mcp')
    const { tools } = await client.listTools()
    expect(tools.map((x) => x.name)).toEqual(['execute'])
    expect(tools[0]?.description).toContain('declare const alpha: {')
    expect(tools[0]?.description).toContain('declare const beta_2: {')
    expect(tools[0]?.description).toContain('add(input: {')
  })

  it('runs code that chains and parallelizes tool calls across servers', async () => {
    t = await startDaemon(config)
    const result = await run(`async () => {
      const [x, y] = await Promise.all([alpha.add({ a: 1, b: 2 }), beta_2.add({ a: 10, b: 20 })])
      const echoed = await alpha.echo({ text: String(x.sum + y.sum) })
      console.log('sum', x.sum + y.sum)
      return { echoed }
    }`)
    expect(result.isError).toBeFalsy()
    expect(text(result)).toContain('Logs:\nlog: sum 33')
    expect(text(result)).toContain('"echoed": "alpha:33"')
    const audit = t.daemon.audit.recent()
    expect(audit.filter((e) => e.via === 'code')).toHaveLength(3)
  })

  it('throws tool errors into the code and enforces the profile', async () => {
    t = await startDaemon(config)
    const caught = await run('try { await alpha.fail() } catch (e) { return e.message }')
    expect(text(caught)).toContain('"it failed"')
    const excluded = await run('await beta_2.fail()')
    expect(excluded.isError).toBe(true)
    expect(text(excluded)).toMatch(/beta_2\.fail is not a tool in this profile/)
  })

  it('applies the profile budgets', async () => {
    t = await startDaemon(config)
    const calls = await run('for (let i = 0; i < 10; i++) await alpha.pid()')
    expect(text(calls)).toMatch(/^budget error/)
    const slow = await run('await alpha.sleep({ ms: 10000 })')
    expect(text(slow)).toMatch(/^timeout error/)
  })

  it('offers search and describe inside the sandbox', async () => {
    t = await startDaemon(config)
    const result = await run(`async () => {
      const hits = await catalog.search('add numbers')
      return { first: hits[0].name, types: await catalog.describe([hits[0].name]) }
    }`)
    expect(text(result)).toMatch(/"first": "(alpha|beta_2)\.add"/)
    expect(text(result)).toContain('a: number;')
  })
})
