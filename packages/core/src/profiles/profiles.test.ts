import { parseConfig } from '@switchboard/shared'
import { describe, expect, it } from 'vitest'
import { Catalog } from '../catalog.ts'
import { resolveProfile } from './resolve.ts'
import { buildProfileView, exposedToolName, MAX_TOOL_NAME } from './view.ts'

const server = { transport: 'stdio', command: 'x' }
const config = parseConfig({
  servers: { github: server, linear: server, disabled: { ...server, enabled: false } },
  profiles: {
    work: {
      servers: ['github'],
      include: ['linear.list_*'],
      exclude: ['github.delete_*'],
      overrides: { 'github.search': { name: 'gh_search', description: 'Search GitHub' } },
    },
    other: {},
  },
  clientRules: [
    { client: 'cursor*', profile: 'work' },
    { client: '*', profile: 'other' },
  ],
})

function catalogWith(tools: Record<string, string[]>): Catalog {
  const catalog = new Catalog()
  for (const [name, list] of Object.entries(tools)) {
    catalog.set(name, {
      tools: list.map((t) => ({ name: t, inputSchema: { type: 'object' } })),
      syncedAt: '',
      configHash: '',
    })
  }
  return catalog
}

describe('buildProfileView', () => {
  it('combines servers, include, exclude and overrides', () => {
    const catalog = catalogWith({
      github: ['search', 'delete_repo', 'create_issue'],
      linear: ['list_issues', 'create_issue'],
    })
    const view = buildProfileView('work', config, catalog)
    expect(view.tools.map((t) => t.name).sort()).toEqual([
      'gh_search',
      'github__create_issue',
      'linear__list_issues',
    ])
    expect(view.byId.get('github.search')?.definition.description).toBe('Search GitHub')
    expect(view.servers.sort()).toEqual(['github', 'linear'])
  })
})

describe('exposedToolName', () => {
  it('sanitizes and keeps names within the limit', () => {
    expect(exposedToolName('my-server', 'do.thing')).toBe('my-server__do_thing')
    const long = exposedToolName('server', 'x'.repeat(100))
    expect(long.length).toBe(MAX_TOOL_NAME)
    expect(long).not.toBe(exposedToolName('server', `${'x'.repeat(99)}y`))
  })
})

describe('resolveProfile', () => {
  it('prefers path, then header, then client rules, then default', () => {
    expect(resolveProfile({ path: 'other', header: 'work' }, config)).toMatchObject({
      profile: 'other',
      via: 'path',
    })
    expect(resolveProfile({ header: 'work', clientName: 'x' }, config)).toMatchObject({ via: 'header' })
    expect(resolveProfile({ clientName: 'Cursor-VSCode' }, config)).toMatchObject({ profile: 'work' })
    expect(resolveProfile({ clientName: 'claude-code' }, config)).toMatchObject({ profile: 'other' })
  })

  it('explains unknown profiles', () => {
    const result = resolveProfile({ header: 'nope' }, config)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('work, other')
  })
})

describe('parseConfig', () => {
  it('reports references to unknown servers and profiles', () => {
    expect(() =>
      parseConfig({ profiles: { a: { servers: ['ghost'] } }, clientRules: [{ client: 'x', profile: 'b' }] }),
    ).toThrow(/unknown server "ghost"[\s\S]*unknown profile "b"/)
  })

  it('rejects names that cannot be used in URLs', () => {
    expect(() => parseConfig({ profiles: { 'Has Space': {} } })).toThrow()
  })
})
