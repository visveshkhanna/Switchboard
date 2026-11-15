import { timingSafeEqual } from 'node:crypto'
import {
  brand,
  type ClientRule,
  ConfigError,
  clientRuleSchema,
  configSchema,
  profileSchema,
  serverConfigSchema,
  serverInstances,
  settingsSchema,
  slugSchema,
} from '@switchboard/shared'
import { type Context, Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import { connectClient, disconnectClient, importCandidates, listClients } from '../clients/files.ts'
import type { Daemon } from '../daemon.ts'
import { resolveProfile } from '../profiles/resolve.ts'
import { buildProfileView } from '../profiles/view.ts'
import { computeStats, RANGES, type Range } from '../stats.ts'
import { pickSurface } from '../surfaces/types.ts'
import { hasAdminSession } from './auth.ts'

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
    // The admin token (CLI, local web UI) or, when hosted, a logged-in web UI session.
    if (!tokenMatches(token, daemon.adminToken) && !hasAdminSession(daemon, c)) {
      return c.json(
        {
          error: daemon.remote
            ? 'Log in to the web UI, or send the admin token.'
            : `Missing or wrong admin token (see ${daemon.paths.adminToken}).`,
        },
        401,
      )
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
      remote: daemon.remote,
      baseUrl: daemon.baseUrl,
      keys: daemon.keys.size,
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
    const instances = serverInstances(config())
    return c.json(
      Object.entries(config().servers).map(([name, server]) => {
        const own = instances.filter((i) => i.server === name)
        return {
          name,
          config: server,
          // The default instance, or the first account when every profile has its own.
          status: statuses.get(own[0]?.id ?? name),
          instances: own.map((i) => ({
            id: i.id,
            account: i.account,
            profiles: i.profiles,
            status: statuses.get(i.id),
          })),
        }
      }),
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
          delete profile.credentials[name]
        }
        return draft
      })
      return c.json({ ok: true })
    } catch (error) {
      return problem(c, error)
    }
  })
  // :name is a server or one of its instances (`github.work`); a server falls back to its first account.
  api.get('/servers/:name/tools', (c) => {
    const name = c.req.param('name')
    const id = daemon.catalog.has(name)
      ? name
      : serverInstances(config()).find((i) => i.server === name && daemon.catalog.has(i.id))?.id
    return c.json((id && daemon.catalog.get(id)?.tools) || [])
  })
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
        // New clients use the default profile, so there should always be one.
        draft.defaultProfile ??= name
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
        for (const client of Object.values(draft.clients)) if (client.profile === name) delete client.profile
        if (draft.defaultProfile === name) draft.defaultProfile = Object.keys(draft.profiles)[0]
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
      await daemon.upstream.ensureCatalog(view.instances)
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
        missingServers: fresh.servers.filter((_, i) => !daemon.catalog.get(fresh.instances[i]!)),
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

  // Settings
  const settingsView = () => ({
    activityLog: config().settings.activityLog ?? null,
    retentionDays: config().settings.retentionDays,
  })
  api.get('/settings', (c) => c.json(settingsView()))
  api.put('/settings', async (c) => {
    try {
      const patch = settingsSchema.partial().parse(await c.req.json())
      await update((d) => ({ ...d, settings: { ...d.settings, ...patch } }))
      if (patch.retentionDays) void daemon.audit.prune().catch(() => undefined)
      return c.json(settingsView())
    } catch (error) {
      return problem(c, error)
    }
  })

  // Charts for the activity page
  api.get('/stats', async (c) => {
    const range = (c.req.query('range') ?? '24h') as Range
    if (!(range in RANGES))
      return c.json({ error: `range must be one of ${Object.keys(RANGES).join(', ')}` }, 400)
    const { events, source } = await daemon.audit.since(Date.now() - RANGES[range].durationMs)
    return c.json(computeStats(events, range, source))
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
      const onSeen = () => void send('clients', null)
      daemon.seen.on('change', onSeen)
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
      daemon.seen.off('change', onSeen)
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

  // Clients: the ones Switchboard can configure, plus every client that has connected.
  const base = () => daemon.baseUrl
  const clientsView = async () => {
    const cfg = config()
    // When hosted, the clients are on other machines: there are no local config files to set up.
    const presets = daemon.remote ? [] : await listClients(daemon.clientEnv)
    const counts = daemon.sessions.countsByClient()
    const seen = new Map(daemon.seen.list().map((s) => [s.id, s]))
    const ids = new Set([...presets.map((p) => p.id), ...seen.keys(), ...Object.keys(cfg.clients)])
    const rows = [...ids].map((id) => {
      const preset = presets.find((p) => p.id === id)
      const last = seen.get(id)
      const own = cfg.clients[id]
      const resolved = resolveProfile({ clientId: id, clientName: last?.name }, cfg)
      const count = counts.get(id)
      return {
        id,
        name: preset?.name ?? own?.name ?? last?.name ?? id,
        clientInfoName: last?.name ?? null,
        version: last?.version ?? null,
        firstSeen: last?.firstSeen ?? null,
        lastSeen: last?.lastSeen ?? null,
        /** What the user chose: a profile, every profile off, or the default profile. */
        selection: own?.profile === undefined ? 'default' : own.profile === null ? 'off' : 'profile',
        profile: own?.profile ?? null,
        /** What the client gets now, from its choice, a client rule or the default. */
        effectiveProfile: resolved.ok ? resolved.profile : null,
        via: resolved.ok ? resolved.via : resolved.reason === 'disabled' ? 'disabled' : 'unassigned',
        sessions: count?.sessions ?? 0,
        waiting: count?.waiting ?? 0,
        url: `${base()}/c/${id}/mcp`,
        preset: preset
          ? {
              installed: preset.installed,
              configPath: preset.configPath,
              configExists: preset.configExists,
              docs: preset.docs,
              error: preset.error ?? null,
              /** How the client's config file reaches Switchboard. */
              setup: preset.connectedMode ?? (preset.foreignEntry ? 'foreign' : 'none'),
              pinnedProfile: preset.connectedProfile ?? null,
              managedId: preset.connectedClient ?? null,
              otherServers: preset.serverCount,
            }
          : null,
      }
    })
    const rank = (r: (typeof rows)[number]) =>
      r.sessions
        ? 0
        : r.lastSeen
          ? 1
          : r.preset?.installed
            ? 2
            : r.preset?.setup && r.preset.setup !== 'none'
              ? 2
              : 3
    return rows.sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (b.lastSeen ?? '').localeCompare(a.lastSeen ?? '') ||
        a.name.localeCompare(b.name),
    )
  }
  api.get('/clients', async (c) => c.json(await clientsView()))

  /** Switch a client's profile: a profile, null for none, or { useDefault: true }. Open sessions move at once. */
  api.put('/clients/:id/profile', async (c) => {
    try {
      const id = slugSchema.parse(c.req.param('id'))
      const body = z
        .union([z.object({ profile: slugSchema.nullable() }), z.object({ useDefault: z.literal(true) })])
        .parse(await c.req.json())
      if ('profile' in body && body.profile && !config().profiles[body.profile]) {
        return c.json({ error: `Unknown profile "${body.profile}"` }, 404)
      }
      const name = daemon.seen.get(id)?.name
      await update((d) => {
        const current = d.clients[id] ?? {}
        if ('useDefault' in body) {
          const { profile: _drop, ...rest } = current
          d.clients[id] = rest
        } else {
          d.clients[id] = { ...current, ...(name && !current.name ? { name } : {}), profile: body.profile }
        }
        return d
      })
      return c.json((await clientsView()).find((r) => r.id === id) ?? null)
    } catch (error) {
      return problem(c, error)
    }
  })

  /**
   * Write Switchboard into a client's config file. By default the entry is the
   * client's own URL, so its profile can be switched later without touching
   * the file again; `{ profile }` pins a profile in the URL instead, and
   * `{ profile: null }` uses the shared /mcp URL.
   */
  const localOnly = (c: Context) =>
    c.json(
      {
        error: `${brand.displayName} is hosted, so it cannot edit config files on your machine. Copy the client's URL and an API key into the client instead.`,
      },
      409,
    )
  api.post('/clients/:id/connect', async (c) => {
    if (daemon.remote) return localOnly(c)
    try {
      const id = slugSchema.parse(c.req.param('id'))
      const body = z
        .object({ profile: slugSchema.nullable().optional() })
        .parse(await c.req.json().catch(() => ({})))
      if (body.profile && !config().profiles[body.profile]) {
        return c.json({ error: `Unknown profile "${body.profile}"` }, 404)
      }
      const target =
        body.profile === undefined
          ? { url: `${base()}/c/${id}/mcp`, profile: null, client: id }
          : { url: `${base()}${body.profile ? `/p/${body.profile}` : ''}/mcp`, profile: body.profile }
      const result = await connectClient(id, target, daemon.clientEnv, daemon.paths.backups)
      return c.json({ ok: true, ...result })
    } catch (error) {
      return problem(c, error, 409)
    }
  })
  api.post('/clients/:id/disconnect', async (c) => {
    if (daemon.remote) return localOnly(c)
    try {
      return c.json({
        ok: true,
        ...(await disconnectClient(c.req.param('id'), daemon.clientEnv, daemon.paths.backups)),
      })
    } catch (error) {
      return problem(c, error, 409)
    }
  })
  /** Forget a client: its history and its profile choice. Config files are not touched. */
  api.delete('/clients/:id', async (c) => {
    const id = c.req.param('id')
    daemon.seen.forget(id)
    if (config().clients[id]) {
      await update((d) => {
        delete d.clients[id]
        return d
      })
    }
    return c.json({ ok: true })
  })

  // API keys: each identifies a client. Required for MCP clients when hosted.
  api.get('/keys', (c) => c.json(daemon.keys.list()))
  api.post('/keys', async (c) => {
    try {
      const { client, label } = z
        .object({ client: slugSchema, label: z.string().max(100).optional() })
        .parse(await c.req.json())
      const created = await daemon.keys.create(client, label)
      // The token is returned this once; only its hash is stored.
      return c.json({ ...created, url: `${base()}/c/${client}/mcp` })
    } catch (error) {
      return problem(c, error)
    }
  })
  api.delete('/keys/:id', async (c) => c.json({ ok: await daemon.keys.remove(c.req.param('id')) }))

  // Import servers from client configs
  api.get('/import', async (c) => {
    if (daemon.remote) return c.json([])
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
