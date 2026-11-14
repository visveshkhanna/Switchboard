import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { parse as parseToml } from 'smol-toml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { connectClient, disconnectClient, importCandidates, listClients, toSlug } from './files.ts'
import type { ClientEnv } from './registry.ts'

let home: string
let env: ClientEnv
let backups: string
const target = { url: 'http://127.0.0.1:7690/p/work/mcp', profile: 'work' }

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'switchboard-clients-'))
  env = { home, platform: 'linux' }
  backups = join(home, 'backups')
})
afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

async function put(path: string, text: string) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
}

describe('client config files', () => {
  it('adds an entry to Cursor while keeping comments and other servers', async () => {
    const path = join(home, '.cursor', 'mcp.json')
    await put(
      path,
      '{\n  // my servers\n  "mcpServers": {\n    "github": { "command": "npx", "args": ["gh"] }\n  }\n}\n',
    )
    const { backup } = await connectClient('cursor', target, env, backups)
    const text = await readFile(path, 'utf8')
    expect(text).toContain('// my servers')
    expect(text).toContain('"github"')
    expect(text).toContain('"url": "http://127.0.0.1:7690/p/work/mcp"')
    expect(backup).toBeDefined()
    expect(await readdir(backups)).toHaveLength(1)

    const [cursor] = (await listClients(env)).filter((c) => c.id === 'cursor')
    expect(cursor).toMatchObject({ installed: true, connectedProfile: 'work', serverCount: 1 })

    await disconnectClient('cursor', env, backups)
    expect(await readFile(path, 'utf8')).not.toContain('switchboard')
  })

  it('creates the file when the client has none', async () => {
    await connectClient('claude-code', target, env, backups)
    const data = JSON.parse(await readFile(join(home, '.claude.json'), 'utf8'))
    expect(data.mcpServers.switchboard).toEqual({ type: 'http', url: target.url })
  })

  it('writes the stdio bridge for Claude Desktop and TOML for Codex', async () => {
    await connectClient('claude-desktop', target, env, backups)
    const desktop = JSON.parse(
      await readFile(join(home, '.config', 'Claude', 'claude_desktop_config.json'), 'utf8'),
    )
    expect(desktop.mcpServers.switchboard.args).toEqual([
      '-y',
      'mcp-switchboard',
      'connect',
      '--profile',
      'work',
    ])

    await put(join(home, '.codex', 'config.toml'), 'model = "o4"\n\n[mcp_servers.other]\ncommand = "x"\n')
    await connectClient('codex', target, env, backups)
    const codex = parseToml(await readFile(join(home, '.codex', 'config.toml'), 'utf8')) as Record<
      string,
      any
    >
    expect(codex.model).toBe('o4')
    expect(codex.mcp_servers.switchboard.url).toBe(target.url)
    expect(codex.mcp_servers.other.command).toBe('x')
  })

  it('refuses to overwrite an entry it did not write', async () => {
    await put(
      join(home, '.cursor', 'mcp.json'),
      '{"mcpServers":{"switchboard":{"command":"something-else"}}}',
    )
    await expect(connectClient('cursor', target, env, backups)).rejects.toThrow(/did not write/)
  })

  it('finds servers to import from every client', async () => {
    await put(
      join(home, '.cursor', 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          'GitHub Server': { command: 'npx', args: ['-y', 'gh'], env: { TOKEN: 'x' } },
          remote: { url: 'https://example.com/mcp', headers: { Authorization: 'Bearer y' } },
          switchboard: { url: target.url },
        },
      }),
    )
    await put(
      join(home, '.gemini', 'settings.json'),
      JSON.stringify({ mcpServers: { old: { url: 'https://e.com/sse', type: 'sse' } } }),
    )
    const found = await importCandidates(env)
    expect(found.map((f) => `${f.client}:${f.name}:${f.server.transport}`).sort()).toEqual([
      'cursor:github-server:stdio',
      'cursor:remote:http',
      'gemini-cli:old:sse',
    ])
  })

  it('makes valid server names', () => {
    expect(toSlug('My Server!')).toBe('my-server')
    expect(toSlug('___')).toBe('server-x')
    expect(toSlug('--a_b--')).toBe('a_b')
  })

  it('handles hostile names in linear time', () => {
    const started = performance.now()
    expect(toSlug(`${'-'.repeat(1000)}x`)).toBe('x')
    expect(toSlug(`a${'-'.repeat(100_000)}`)).toBe('a')
    expect(toSlug(`${'-'.repeat(100_000)}x`)).toBe('server-x')
    expect(performance.now() - started).toBeLessThan(200)
  })
})
