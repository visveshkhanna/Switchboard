import { mkdtemp, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, describe, expect, it } from 'vitest'
import { Daemon } from '../src/daemon.ts'
import { silentLogger } from '../src/logger.ts'
import { FileSecretBackend, resolveSecrets } from '../src/secrets.ts'
import { startDaemon, stdioServer, type TestDaemon } from './helpers.ts'

let t: TestDaemon
afterEach(async () => {
  await t?.close()
})

const config = {
  servers: { alpha: stdioServer('alpha') },
  profiles: { work: { servers: ['alpha'], surface: 'passthrough' as const } },
  defaultProfile: 'work',
}

async function hosted() {
  const web = await mkdtemp(join(tmpdir(), 'sb-web-'))
  await writeFile(join(web, 'index.html'), '<html><head></head><body></body></html>')
  return startDaemon(config, {
    publicUrl: 'https://sb.example.com',
    adminPassword: 'correct horse',
    webRoot: web,
  })
}

async function mcpClient(path: string, key?: string) {
  const transport = new StreamableHTTPClientTransport(new URL(path, t.url), {
    requestInit: { headers: key ? { authorization: `Bearer ${key}` } : {} },
  })
  const client = new Client({ name: 'remote-test', version: '1.0.0' })
  await client.connect(transport)
  return client
}

describe('hosted (remote) mode', () => {
  it('requires an API key, and the key names the client', async () => {
    t = await hosted()
    expect(t.daemon.remote).toBe(true)
    await expect(mcpClient('/mcp')).rejects.toThrow(/needs an API key/)
    await expect(mcpClient('/mcp', 'sbk_nope_nope')).rejects.toThrow(/Invalid API key/)

    const { token } = await t.daemon.keys.create('laptop', 'MacBook')
    expect(token).toMatch(/^sbk_[0-9a-f]{12}_/)
    const client = await mcpClient('/mcp', token)
    expect((await client.listTools()).tools.map((x) => x.name)).toContain('alpha__echo')
    expect(t.daemon.sessions.list()[0]).toMatchObject({ clientId: 'laptop', profile: 'work' })
    await expect(mcpClient('/c/someone-else/mcp', token)).rejects.toThrow(/belongs to client .*laptop/)
    expect(t.daemon.keys.list()[0]).toMatchObject({ client: 'laptop', label: 'MacBook' })
    expect(JSON.stringify(t.daemon.keys.list())).not.toContain(token.split('_').at(-1)!)
    await client.close()
  })

  it('protects the web UI with a password, a session cookie and a CSRF header', async () => {
    t = await hosted()
    const html = await (await fetch(`${t.url}/`)).text()
    expect(html).not.toContain('switchboard-token')
    expect((await fetch(`${t.url}/api/status`)).status).toBe(401)

    const json = { 'content-type': 'application/json' }
    const wrong = await fetch(`${t.url}/auth/login`, {
      method: 'POST',
      headers: json,
      body: '{"password":"nope"}',
    })
    expect(wrong.status).toBe(401)
    const login = await fetch(`${t.url}/auth/login`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ password: 'correct horse' }),
    })
    expect(login.status).toBe(200)
    const cookie = login.headers.get('set-cookie')!
    expect(cookie).toMatch(/HttpOnly/)
    expect(cookie).toMatch(/Secure/)
    expect(cookie).toMatch(/SameSite=Strict/)
    const session = cookie.split(';')[0]!

    const status = await fetch(`${t.url}/api/status`, { headers: { cookie: session } })
    expect(await status.json()).toMatchObject({ remote: true, baseUrl: 'https://sb.example.com' })
    const put = (headers: Record<string, string>) =>
      fetch(`${t.url}/api/default-profile`, {
        method: 'PUT',
        headers: { ...json, cookie: session, ...headers },
        body: '{"profile":"work"}',
      })
    expect((await put({})).status).toBe(401)
    expect((await put({ 'x-switchboard-csrf': '1' })).status).toBe(200)

    const created = await fetch(`${t.url}/api/keys`, {
      method: 'POST',
      headers: { ...json, cookie: session, 'x-switchboard-csrf': '1' },
      body: '{"client":"phone"}',
    })
    expect(await created.json()).toMatchObject({ url: 'https://sb.example.com/c/phone/mcp' })

    // Clients are on other machines: no local presets, no config file writes.
    const clients = (await (
      await fetch(`${t.url}/api/clients`, { headers: { cookie: session } })
    ).json()) as { preset: unknown }[]
    expect(clients.some((r) => r.preset)).toBe(false)
    const connect = await fetch(`${t.url}/api/clients/cursor/connect`, {
      method: 'POST',
      headers: { ...json, cookie: session, 'x-switchboard-csrf': '1' },
      body: '{}',
    })
    expect(connect.status).toBe(409)
  })

  it('accepts the public host and limits login attempts', async () => {
    t = await hosted()
    // fetch() ignores a Host header, so use node:http to send one.
    const statusWithHost = (host: string) =>
      new Promise<number>((resolve, reject) => {
        const req = request(`${t.url}/healthz`, { headers: { host } }, (res) => {
          res.resume()
          resolve(res.statusCode ?? 0)
        })
        req.on('error', reject)
        req.end()
      })
    expect(await statusWithHost('sb.example.com')).toBe(200)
    // Health checks pass with any Host; everything else does not.
    expect(await statusWithHost('evil.example')).toBe(200)
    const apiWithHost = await new Promise<number>((resolve, reject) => {
      const req = request(`${t.url}/api/status`, { headers: { host: 'evil.example' } }, (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      })
      req.on('error', reject)
      req.end()
    })
    expect(apiWithHost).toBe(403)
    let last = 0
    for (let i = 0; i < 12; i++) {
      last = (
        await fetch(`${t.url}/auth/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{"password":"x"}',
        })
      ).status
    }
    expect(last).toBe(429)
  })

  it('refuses to start hosted without an admin password', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sb-nopw-'))
    const daemon = await Daemon.create({
      home,
      port: 0,
      host: '0.0.0.0',
      logger: silentLogger,
      secretsBackend: 'file',
    })
    await expect(daemon.listen()).rejects.toThrow(/needs an admin password/)
  })

  it('keeps keys optional locally, but honours them', async () => {
    t = await startDaemon(config)
    const { token } = await t.daemon.keys.create('desk')
    await mcpClient('/mcp', token)
    expect(t.daemon.sessions.list()[0]).toMatchObject({ clientId: 'desk' })
  })
})

describe('env:// secrets', () => {
  it('reads environment variables and reports missing ones', async () => {
    const backend = new FileSecretBackend(join(await mkdtemp(join(tmpdir(), 'sb-env-')), 's.json'))
    const out = await resolveSecrets({ A: 'Bearer env://SB_TEST_TOKEN' }, backend, { SB_TEST_TOKEN: 'xyz' })
    expect(out.A).toBe('Bearer xyz')
    await expect(resolveSecrets({ A: 'env://MISSING_ONE' }, backend, {})).rejects.toThrow(
      /env:\/\/MISSING_ONE/,
    )
  })
})
