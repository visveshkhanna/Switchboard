import { describe, expect, it } from 'vitest'
import { normalizeCode, runInSandbox, type SandboxBudget, type SandboxHost } from './sandbox.ts'

const budget: SandboxBudget = { timeoutMs: 2000, memoryMb: 32, maxToolCalls: 10, maxSourceBytes: 10_000 }

const host: SandboxHost = {
  async callTool(ns, tool, args) {
    if (tool === 'boom') throw new Error('upstream exploded')
    if (tool === 'slow') await new Promise((r) => setTimeout(r, 50))
    return { ns, tool, args }
  },
  helpers: { search: async ([q]) => [`found ${q}`] },
}

describe('normalizeCode', () => {
  it('accepts functions, statements and fenced code', () => {
    expect(normalizeCode('async () => 1')).toBe('(async () => 1)')
    expect(normalizeCode('return 1')).toBe('(async () => {\nreturn 1\n})')
    expect(normalizeCode('```js\nasync () => 2\n```')).toBe('(async () => 2)')
  })
})

describe('runInSandbox', () => {
  it('returns values and captures logs', async () => {
    const r = await runInSandbox('console.log("hi", {a: 1}); return [1, "two"]', [], host, budget)
    expect(r).toMatchObject({ ok: true, result: [1, 'two'], logs: ['log: hi {"a":1}'] })
  })

  it('calls tools through namespaces, in parallel', async () => {
    const code = `async () => {
      const [a, b] = await Promise.all([gh.slow({ x: 1 }), gh.slow({ x: 2 })])
      return [a.args.x, b.args.x, (await catalog.search('issues'))[0]]
    }`
    const r = await runInSandbox(code, ['gh'], host, budget)
    expect(r.result).toEqual([1, 2, 'found issues'])
    expect(r.toolCalls).toBe(2)
  })

  it('lets code catch tool errors', async () => {
    const r = await runInSandbox(
      'try { await gh.boom() } catch (e) { return e.message }',
      ['gh'],
      host,
      budget,
    )
    expect(r.result).toBe('upstream exploded')
  })

  it('reports syntax and runtime errors', async () => {
    expect((await runInSandbox('return (', [], host, budget)).error?.kind).toBe('syntax')
    const r = await runInSandbox('null.x', [], host, budget)
    expect(r.error).toMatchObject({ kind: 'runtime' })
    expect(r.error?.message).toMatch(/TypeError/)
  })

  it('stops infinite loops', async () => {
    const r = await runInSandbox('while (true) {}', [], host, { ...budget, timeoutMs: 200 })
    expect(r.error?.kind).toBe('timeout')
    expect(r.durationMs).toBeLessThan(2000)
  })

  it('stops code that waits forever', async () => {
    const r = await runInSandbox('await new Promise(() => {})', [], host, { ...budget, timeoutMs: 200 })
    expect(r.error?.kind).toBe('timeout')
  })

  it('enforces memory and tool call budgets', async () => {
    const memory = await runInSandbox(
      'const a = []; for (let i = 0; ; i++) a.push({ i, s: "item" + i })',
      [],
      host,
      budget,
    )
    expect(memory.error?.kind).toBe('memory')
    const calls = await runInSandbox('for (let i = 0; i < 20; i++) await gh.x()', ['gh'], host, {
      ...budget,
      maxToolCalls: 3,
    })
    expect(calls.error?.kind).toBe('budget')
    expect(calls.toolCalls).toBe(4)
  })

  it('has no access to Node', async () => {
    const r = await runInSandbox(
      'return [typeof require, typeof process, typeof fetch, typeof setTimeout, typeof globalThis.Buffer]',
      [],
      host,
      budget,
    )
    expect(r.result).toEqual(['undefined', 'undefined', 'undefined', 'undefined', 'undefined'])
  })

  it('rejects code over the size limit', async () => {
    const r = await runInSandbox('x'.repeat(200), [], host, { ...budget, maxSourceBytes: 100 })
    expect(r.error?.kind).toBe('budget')
  })

  it('stays usable after many failed runs', async () => {
    for (let i = 0; i < 5; i++) {
      await runInSandbox('await gh.slow(); while(true){}', ['gh'], host, { ...budget, timeoutMs: 100 })
    }
    expect((await runInSandbox('return 42', [], host, budget)).result).toBe(42)
  })
})
