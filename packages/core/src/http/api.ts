import { timingSafeEqual } from 'node:crypto'
import {
  brand,
  type ClientRule,
  ConfigError,
  clientRuleSchema,
  configSchema,
  profileSchema,
  serverConfigSchema,
  slugSchema,
} from '@switchboard/shared'
import { type Context, Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import { connectClient, disconnectClient, importCandidates, listClients } from '../clients/files.ts'
import type { Daemon } from '../daemon.ts'
import { buildProfileView } from '../profiles/view.ts'
import { pickSurface } from '../surfaces/types.ts'

function tokenMatches(given: string | undefined, expected: string): boolean {
  if (!given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function problem(c: Context, error: unknown, status: 400 | 404 | 409 | 500 = 400) {
  if (error instanceof ConfigError) return c.json({ error: error.message, problems: error.problems }, 400)
  if (error instanceof z.ZodError) {
    return c.json(
      { error: 'Invalid request', problems: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) },
      400,
    )
  }
  return c.json({ error: error instanceof Error ? error.message : String(error) }, status)
}

/** Rough token count of a tool list, for the UI's context estimate. */
function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 4)
}

/**
 * The admin API used by the web UI and the CLI. Every route needs the admin
 * token from ~/.switchboard/admin-token as a bearer token.
 */
export function adminApi(daemon: Daemon): Hono {
  const api = new Hono()

  api.use('*', async (c, next) => {
    const header = c.req.header('authorization')
    const token = header?.startsWith('Bearer ') ? header.slice(7) : c.req.query('token')
    if (!tokenMatches(token, daemon.adminToken)) {
      return c.json({ error: `Missing or wrong admin token (see ${daemon.paths.adminToken}).` }, 401)
    }
    await next()
  })

  const config = () => daemon.config.config
  const update = (fn: Parameters<typeof daemon.config.update>[0]) => daemon.config.update(fn)
  const slug = (c: Context) => slugSchema.parse(c.req.param('name'))

  api.get('/status', (c) =>
    c.json({
      name: brand.name,
      version: daemon.version,
      pid: process.pid,
      port: daemon.info?.port,
      startedAt: daemon.info?.startedAt,
      home: daemon.paths.home,
      configPath: daemon.paths.config,
      secretsBackend: daemon.secrets.kind,
      servers: Object.keys(config().servers).length,
      profiles: Object.keys(config().profiles).length,
      sessions: daemon.sessions.list().length,
    }),
  )

  // Config as a whole
  api.get('/config', (c) => c.json(config()))
  api.put('/config', async (c) => {
    try {
      const next = configSchema.parse(await c.req.json())
      return c.json(await update(() => next))
    } catch (error) {
      return problem(c, error)
    }
  })

  // Servers
  api.get('/servers', (c) => {
    const statuses = new Map(daemon.upstream.statuses().map((s) => [s.name, s]))
    return c.json(
      Object.entries(config().servers).map(([name, server]) => ({
        name,
        config: server,
        status: statuses.get(name),
      })),
    )
  })
  api.put('/servers/:name', async (c) => {
    try {
      const name = slug(c)
      const server = serverConfigSchema.parse(await c.req.json())
      await update((draft) => {
        draft.servers[name] = server
        return draft
      })
      return c.json({ name, config: server })
    } catch (error) {
      return problem(c, error)
    }
  })
  api.delete('/servers/:name', async (c) => {
    try {
      const name = slug(c)
      await update((draft) => {
        delete draft.servers[name]
        for (const profile of Object.values(draft.profiles)) {
          profile.servers = profile.servers.filter((s) => s !== name)
        }
        return draft
      })
      return c.json({ ok: true })
    } catch (error) {
      return problem(c, error)
    }
  })
  api.get('/servers/:name/tools', (c) => c.json(daemon.catalog.get(c.req.param('name'))?.tools ?? []))
  api.get('/servers/:name/logs', (c) => c.json(daemon.upstream.get(c.req.param('name'))?.stderr ?? []))
  /** Start a sign-in for a server that uses OAuth; returns the URL to open. */
  api.post('/servers/:name/auth', async (c) => {
    const connection = daemon.upstream.get(c.req.param('name'))
    if (!connection) return c.json({ error: 'Unknown server' }, 404)
    await connection.stop()
    await connection.sync().catch(() => undefined)
    const status = connection.status()
    if (status.state === 'ready') return c.json({ ok: true, signedIn: true })
    if (status.authUrl) return c.json({ ok: true, authUrl: status.authUrl })
    return c.json({ ok: false, error: status.lastError ?? 'The server did not ask for sign-in.' })
  })
  api.post('/servers/:name/signout', async (c) => {
    const connection = daemon.upstream.get(c.req.param('name'))
    if (!connection) return c.json({ error: 'Unknown server' }, 404)
    await connection.signOut()
    return c.json({ ok: true })
  })
  api.post('/servers/:name/restart', async (c) => {
    const connection = daemon.upstream.get(c.req.param('name'))
    if (!connection) return c.json({ error: 'Unknown server' }, 404)
    await connection.stop()
    try {
      const tools = await connection.sync()
      return c.json({ ok: true, tools: tools.length })
    } catch (error) {
      return c.json({ ok: false, error: (error as Error).message, stderr: connection.stderr.slice(-20) })
    }
  })
  /** Connect and list tools, to check a server works. */
  api.post('/servers/:name/test', async (c) => {
    const connection = daemon.upstream.get(c.req.param('name'))
    if (!connection) return c.json({ error: 'Unknown server' }, 404)
    try {
      const tools = await connection.sync()
      return c.json({ ok: true, tools: tools.map((t) => ({ name: t.name, description: t.description })) })
    } catch (error) {
      return c.json({ ok: false, error: (error as Error).message, stderr: connection.stderr.slice(-20) })
    }
  })

  // Profiles
  api.put('/profiles/:name', async (c) => {
    try {
      const name = slug(c)
      const profile = profileSchema.parse(await c.req.json())
      await update((draft) => {
        draft.profiles[name] = profile
        return draft
      })
      return c.json({ name, profile })
    } catch (error) {
      return problem(c, error)
    }
  })
  api.delete('/profiles/:name', async (c) => {
    try {
      const name = slug(c)
      await update((draft) => {
        delete draft.profiles[name]
        draft.clientRules = draft.clientRules.filter((r) => r.profile !== name)
        if (draft.defaultProfile === name) draft.defaultProfile = undefined
        return draft
      })
      return c.json({ ok: true })
    } catch (error) {
      return problem(c, error)
    }
  })
  /** What a client of this profile sees. Accepts an unsaved profile in the body to preview edits. */
  api.post('/profiles/:name/preview', async (c) => {
    try {
      const name = slug(c)
      const body = await c.req.json().catch(() => undefined)
      const draft = structuredClone(config())
      if (body) draft.profiles[name] = profileSchema.parse(body)
      if (!draft.profiles[name]) return c.json({ error: 'Unknown profile' }, 404)
      const view = buildProfileView(name, draft, daemon.catalog)
      await daemon.upstream.ensureCatalog(view.servers)
      const fresh = buildProfileView(name, draft, daemon.catalog)
      const surfaceKind = pickSurface(fresh)
      const surface = daemon.surfaces[surfaceKind]
      const listed = surface.listTools(fresh)
      const all = fresh.tools.map((t) => t.definition)
      return c.json({
        surface: surfaceKind,
        tools: fresh.tools.map((t) => ({
          id: t.id,
          name: t.name,
          server: t.server,
          description: t.definition.description,
        })),
        listed: listed.map((t) => t.name),
        tokens: { listed: estimateTokens(listed), passthrough: estimateTokens(all) },
        missingServers: fresh.servers.filter((s) => !daemon.catalog.get(s)),
      })
    } catch (error) {
      return problem(c, error)
    }
  })

  // Client rules and default profile
  api.put('/client-rules', async (c) => {
    try {
      const rules: ClientRule[] = z.array(clientRuleSchema).parse(await c.req.json())
      return c.json((await update((d) => ({ ...d, clientRules: rules }))).clientRules)
    } catch (error) {
      return problem(c, error)
    }
  })
  api.put('/default-profile', async (c) => {
    try {
      const { profile } = z.object({ profile: slugSchema.nullable() }).parse(await c.req.json())
      await update((d) => ({ ...d, defaultProfile: profile ?? undefined }))
      return c.json({ profile })
    } catch (error) {
      return problem(c, error)
    }
  })

  // Sessions and activity
  api.get('/sessions', (c) => c.json(daemon.sessions.list()))
  api.get('/audit', (c) => c.json(daemon.audit.recent(Number(c.req.query('limit') ?? 200))))
  api.get('/events', (c) =>
    streamSSE(c, async (stream) => {
      const send = (event: string, data: unknown) => stream.writeSSE({ event, data: JSON.stringify(data) })
      const onAudit = (e: unknown) => void send('audit', e)
      const onStatus = (s: unknown) => void send('server', s)
      const onSessions = () => void send('sessions', daemon.sessions.list())
      const onConfig = () => void send('config', daemon.config.config)
      daemon.audit.on('event', onAudit)
      daemon.upstream.on('status', onStatus)
      daemon.sessions.on('change', onSessions)
      daemon.config.on('change', onConfig)
      // Send something at once so proxies and browsers see the stream is open.
      await send('ready', { version: daemon.version })
      const keepAlive = setInterval(() => void stream.writeSSE({ event: 'ping', data: '' }), 15_000)
      await new Promise<void>((resolve) => stream.onAbort(resolve))
      clearInterval(keepAlive)
      daemon.audit.off('event', onAudit)
      daemon.upstream.off('status', onStatus)
      daemon.sessions.off('change', onSessions)
      daemon.config.off('change', onConfig)
    }),
  )

  // Secrets: names only; values are write-only.
  api.get('/secrets', async (c) =>
    c.json({ backend: daemon.secrets.kind, names: await daemon.secrets.list() }),
  )
  api.put('/secrets/:name', async (c) => {
    try {
      const name = z
        .string()
        .regex(/^[A-Za-z0-9_.-]+$/)
        .parse(c.req.param('name'))
      const { value } = z.object({ value: z.string().min(1) }).parse(await c.req.json())
      await daemon.secrets.set(name, value)
      return c.json({ ok: true })
    } catch (error) {
      return problem(c, error)
    }
  })
  api.delete('/secrets/:name', async (c) => {
    await daemon.secrets.delete(c.req.param('name'))
    return c.json({ ok: true })
  })

  // AI clients
  const endpoint = (profile: string) =>
    `http://127.0.0.1:${daemon.info?.port ?? brand.defaultPort}/p/${profile}/mcp`
  api.get('/clients', async (c) => c.json(await listClients(daemon.clientEnv)))
  api.post('/clients/:id/connect', async (c) => {
    try {
      const { profile } = z.object({ profile: slugSchema }).parse(await c.req.json())
      if (!config().profiles[profile]) return c.json({ error: `Unknown profile "${profile}"` }, 404)
      const result = await connectClient(
        c.req.param('id'),
        { url: endpoint(profile), profile },
        daemon.clientEnv,
        daemon.paths.backups,
      )
      return c.json({ ok: true, ...result })
    } catch (error) {
      return problem(c, error, 409)
    }
  })
  api.post('/clients/:id/disconnect', async (c) => {
    try {
      return c.json({
        ok: true,
        ...(await disconnectClient(c.req.param('id'), daemon.clientEnv, daemon.paths.backups)),
      })
    } catch (error) {
      return problem(c, error, 409)
    }
  })

  // Import servers from client configs
  api.get('/import', async (c) => {
    const existing = config().servers
    const candidates = await importCandidates(daemon.clientEnv)
    return c.json(candidates.map((x) => ({ ...x, exists: !!existing[x.name] })))
  })
  api.post('/import', async (c) => {
    try {
      const { items } = z
        .object({ items: z.array(z.object({ name: slugSchema, server: serverConfigSchema })) })
        .parse(await c.req.json())
      await update((draft) => {
        for (const item of items) draft.servers[item.name] = item.server
        return draft
      })
      return c.json({ ok: true, imported: items.map((i) => i.name) })
    } catch (error) {
      return problem(c, error)
    }
  })

  return api
}
