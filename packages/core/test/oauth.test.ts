import { readFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { type ServerType, serve } from '@hono/node-server'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import { startDaemon, type TestDaemon } from './helpers.ts'

/** A remote MCP server protected by a minimal OAuth 2.1 authorization server. */
async function startProtectedServer(): Promise<{ base: string; server: ServerType }> {
  const app = new Hono()
  let base = ''
  app.get('/.well-known/oauth-protected-resource*', (c) =>
    c.json({ resource: `${base}/mcp`, authorization_servers: [base] }),
  )
  app.get('/.well-known/oauth-authorization-server', (c) =>
    c.json({
      issuer: base,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      registration_endpoint: `${base}/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    }),
  )
  app.post('/register', async (c) => c.json({ ...(await c.req.json()), client_id: 'client-1' }, 201))
  app.get('/authorize', (c) => {
    const redirect = new URL(c.req.query('redirect_uri')!)
    redirect.searchParams.set('code', 'code-1')
    redirect.searchParams.set('state', c.req.query('state')!)
    return c.redirect(redirect.toString())
  })
  app.post('/token', async (c) => {
    const form = await c.req.parseBody()
    if (form.code !== 'code-1' || !form.code_verifier) return c.json({ error: 'invalid_grant' }, 400)
    return c.json({
      access_token: 'token-1',
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: 'refresh-1',
    })
  })
  app.all('/mcp', async (c) => {
    if (c.req.header('authorization') !== 'Bearer token-1') {
      return c.json({ error: 'unauthorized' }, 401, {
        'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`,
      })
    }
    const mcp = new McpServer({ name: 'remote', version: '1.0.0' })
    mcp.registerTool('whoami', { description: 'Who am I' }, async () => ({
      content: [{ type: 'text', text: 'authorized' }],
    }))
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true })
    await mcp.connect(transport)
    return transport.handleRequest(c.req.raw)
  })
  const server = await new Promise<ServerType>((resolve) => {
    const s = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, () => resolve(s))
  })
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { base, server }
}

let t: TestDaemon
let remote: ServerType | undefined
afterEach(async () => {
  await t?.close()
  remote?.close()
})

describe('OAuth for remote servers', () => {
  it('signs in through the browser flow and stores the tokens as secrets', async () => {
    const { base, server } = await startProtectedServer()
    remote = server
    t = await startDaemon({
      servers: { remote: { transport: 'http', url: `${base}/mcp` } },
      profiles: { work: { servers: ['remote'] } },
    })
    const auth = await fetch(`${t.url}/api/servers/remote/auth`, {
      method: 'POST',
      headers: { authorization: `Bearer ${t.daemon.adminToken}` },
    }).then((r) => r.json() as Promise<{ authUrl?: string }>)
    expect(auth.authUrl).toMatch(/\/authorize\?/)
    expect(t.daemon.upstream.get('remote')!.status().state).toBe('needs-auth')

    // What the browser does: follow the authorization server back to the daemon.
    const consent = await fetch(auth.authUrl!, { redirect: 'manual' })
    const callback = consent.headers.get('location')!
    expect(callback).toContain(`${t.url}/oauth/callback`)
    const done = await fetch(callback)
    expect(await done.text()).toContain('Signed in to remote')

    expect(t.daemon.upstream.get('remote')!.status().state).toBe('ready')
    const { client } = await t.connect('/p/work/mcp')
    const result = await client.callTool({ name: 'remote__whoami' })
    expect(result.content).toEqual([{ type: 'text', text: 'authorized' }])

    const secrets = JSON.parse(await readFile(join(t.home, 'secrets.json'), 'utf8'))
    expect(JSON.parse(secrets['oauth.remote.tokens']).access_token).toBe('token-1')
  })

  it('rejects callbacks with an unknown state', async () => {
    t = await startDaemon({})
    const res = await fetch(`${t.url}/oauth/callback?code=x&state=forged`)
    expect(res.status).toBe(400)
  })
})
