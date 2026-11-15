import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url))
const fixture = fileURLToPath(
  new URL('../../../packages/core/test/fixtures/test-server.mjs', import.meta.url),
)
const coreDir = fileURLToPath(new URL('../../../packages/core', import.meta.url))

let root: string
let env: NodeJS.ProcessEnv
let daemon: ChildProcess | undefined

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number }
      server.close(() => resolve(port))
    })
  })
}

async function sb(...args: string[]) {
  const { stdout } = await promisify(execFile)(process.execPath, [cli, ...args], { env, cwd: coreDir })
  return stdout
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'switchboard-cli-'))
  const port = await freePort()
  env = {
    ...process.env,
    HOME: join(root, 'home'),
    USERPROFILE: join(root, 'home'),
    APPDATA: join(root, 'home', 'AppData'),
    SWITCHBOARD_HOME: join(root, 'state'),
    SWITCHBOARD_PORT: String(port),
    NO_COLOR: '1',
  }
})

afterAll(async () => {
  // Wait for the daemon to finish its shutdown writes before removing its state.
  if (daemon && daemon.exitCode === null) {
    const exited = new Promise((resolve) => daemon!.once('exit', resolve))
    daemon.kill('SIGTERM')
    await exited
  }
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('switchboard CLI', () => {
  it('configures servers and profiles', async () => {
    expect(await sb('--version')).toMatch(/^\d+\.\d+\.\d+/)
    expect(await sb('server', 'add', 'alpha', '--', process.execPath, fixture, 'alpha')).toContain(
      'Added server alpha',
    )
    expect(await sb('server', 'test', 'alpha')).toContain('6 tools')
    expect(await sb('profile', 'add', 'work', '--servers', 'alpha', '--exclude', 'alpha.fail')).toContain(
      'the default profile',
    )
    expect(await sb('profile', 'show', 'work')).toContain('alpha__echo')
    expect(await sb('profile', 'show', 'work')).not.toContain('alpha__fail')
    const config = JSON.parse(await readFile(join(root, 'state', 'config.json'), 'utf8'))
    expect(config.profiles.work.servers).toEqual(['alpha'])
  })

  it('connects a client by writing its config file', async () => {
    await sb('client', 'connect', 'cursor', '--profile', 'work')
    const file = JSON.parse(await readFile(join(root, 'home', '.cursor', 'mcp.json'), 'utf8'))
    expect(file.mcpServers.switchboard.url).toMatch(/\/p\/work\/mcp$/)
    expect(await sb('client', 'ls')).toMatch(/cursor\s+Cursor\s+work.*pinned to work/)
  })

  it('serves the profile through the daemon and the stdio bridge', async () => {
    daemon = spawn(process.execPath, [cli, 'up', '--no-open'], { env, cwd: coreDir, stdio: 'ignore' })
    for (let i = 0; i < 100; i++) {
      if ((await sb('status')).includes('running at')) break
      await new Promise((r) => setTimeout(r, 100))
    }
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [cli, 'connect', '--profile', 'work'],
      env: env as Record<string, string>,
      cwd: coreDir,
    })
    const client = new Client({ name: 'cli-test', version: '1.0.0' })
    await client.connect(transport)
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toContain('alpha__add')
    const result = await client.callTool({ name: 'alpha__add', arguments: { a: 20, b: 22 } })
    expect(result.structuredContent).toEqual({ sum: 42 })
    expect(await sb('status')).toMatch(/cli-test\s+work\s+path/)
    await client.close()
  })

  it('sets a client up once and switches its profile live', async () => {
    await sb('profile', 'add', 'lite', '--servers', 'alpha', '--exclude', 'alpha.echo')
    expect(await sb('client', 'connect', 'cursor')).toContain('Set up cursor')
    const file = JSON.parse(await readFile(join(root, 'home', '.cursor', 'mcp.json'), 'utf8'))
    expect(file.mcpServers.switchboard.url).toMatch(/\/c\/cursor\/mcp$/)

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [cli, 'connect', '--client', 'my-agent'],
      env: env as Record<string, string>,
      cwd: coreDir,
    })
    const client = new Client({ name: 'my-agent', version: '1.0.0' })
    await client.connect(transport)
    // "work" was the first profile, so it is the default.
    expect((await client.listTools()).tools.map((t) => t.name)).toContain('alpha__echo')
    expect(await sb('client', 'use', 'my-agent', 'lite')).toContain('my-agent now uses lite')
    for (let i = 0; i < 50; i++) {
      const names = (await client.listTools()).tools.map((t) => t.name)
      if (!names.includes('alpha__echo')) break
      await new Promise((r) => setTimeout(r, 100))
    }
    expect((await client.listTools()).tools.map((t) => t.name)).not.toContain('alpha__echo')
    expect(await sb('client', 'ls')).toMatch(/my-agent\s+my-agent\s+lite/)
    await client.close()
  })

  it('gives a profile its own account of a server', async () => {
    await sb('secret', 'set', 'lite-token', 'l-1')
    expect(
      await sb('profile', 'credentials', 'lite', 'alpha', '--env', 'TOKEN=secret://lite-token'),
    ).toContain('own account of alpha: alpha.lite')
    expect(await sb('profile', 'credentials', 'lite')).toMatch(/alpha\s+alpha\.lite\s+TOKEN/)
    expect(await sb('server', 'ls')).toMatch(/alpha .*\blite\b/)
    expect(await sb('server', 'test', 'alpha', '--profile', 'lite')).toContain('Starting alpha.lite')
    const config = JSON.parse(await readFile(join(root, 'state', 'config.json'), 'utf8'))
    expect(config.profiles.lite.credentials.alpha.env).toEqual({ TOKEN: 'secret://lite-token' })
    await expect(sb('server', 'test', 'alpha.nobody')).rejects.toThrow(/No account "nobody"/)
    expect(await sb('profile', 'credentials', 'lite', 'alpha', '--remove')).toContain(
      "uses alpha's own credentials",
    )
  })

  it('reports usage errors clearly', async () => {
    await expect(sb('profile', 'add', 'Bad Name')).rejects.toThrow(/Invalid profile name/)
    await expect(sb('nonsense')).rejects.toThrow(/Unknown command/)
  })
})
