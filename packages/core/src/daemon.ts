import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rm } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { type ServerType, serve } from '@hono/node-server'
import { brand } from '@switchboard/shared'
import { Hono } from 'hono'
import { AuditLog } from './audit.ts'
import { Catalog } from './catalog.ts'
import { type ClientEnv, defaultClientEnv } from './clients/registry.ts'
import { ConfigStore } from './config/store.ts'
import { writeFileAtomic, writeJson } from './fs.ts'
import { Gateway } from './gateway.ts'
import { adminApi } from './http/api.ts'
import { loopbackGuard } from './http/guard.ts'
import { mcpHandler } from './http/mcp.ts'
import { webUi } from './http/web.ts'
import { createLogger, type Logger } from './logger.ts'
import { type Paths, resolvePaths } from './paths.ts'
import { resolveProfile } from './profiles/resolve.ts'
import { ProfileViews } from './profiles/view.ts'
import { openSecretBackend, type SecretBackend } from './secrets.ts'
import { SeenClients } from './seen-clients.ts'
import { SessionRegistry } from './sessions.ts'
import { codeSurface } from './surfaces/code.ts'
import { metaSurface } from './surfaces/meta.ts'
import { passthroughSurface } from './surfaces/passthrough.ts'
import type { ConcreteSurface, ToolSurface } from './surfaces/types.ts'
import { UpstreamManager } from './upstream/manager.ts'

export interface DaemonOptions {
  home?: string
  port?: number
  host?: string
  version?: string
  logger?: Logger
  /** Extra Host names to accept, e.g. a LAN name when binding beyond loopback. */
  allowedHosts?: string[]
  /** Use the secrets file even if a keychain is available (tests). */
  secretsBackend?: 'auto' | 'file'
  /** Mount extra routes (admin API, web UI) before MCP routes. */
  extend?: (app: Hono, daemon: Daemon) => void
  /** Start servers without a cached catalog in the background at boot. */
  warmCatalog?: boolean
  /** Built web UI to serve at /. */
  webRoot?: string
  /** Where AI client config files are looked for (tests point this at a temp dir). */
  clientEnv?: ClientEnv
}

export interface DaemonInfo {
  pid: number
  port: number
  host: string
  version: string
  startedAt: string
}

export class Daemon {
  readonly app = new Hono()
  #server?: ServerType
  #info?: DaemonInfo
  #onListen?: (port: number) => void
  #pruneTimer?: NodeJS.Timeout

  private constructor(
    readonly paths: Paths,
    readonly config: ConfigStore,
    readonly catalog: Catalog,
    readonly secrets: SecretBackend,
    readonly upstream: UpstreamManager,
    readonly views: ProfileViews,
    readonly gateway: Gateway,
    readonly sessions: SessionRegistry,
    readonly surfaces: Record<ConcreteSurface, ToolSurface>,
    readonly seen: SeenClients,
    readonly audit: AuditLog,
    readonly adminToken: string,
    readonly log: Logger,
    readonly options: DaemonOptions,
  ) {}

  static async create(options: DaemonOptions = {}): Promise<Daemon> {
    const log = options.logger ?? createLogger()
    const version = options.version ?? '0.0.0'
    const paths = resolvePaths(options.home)
    await mkdir(paths.home, { recursive: true, mode: 0o700 })

    const config = await ConfigStore.open(paths.config, log.child('config'))
    const catalog = await Catalog.open(paths.catalog)
    const secrets = await openSecretBackend(paths.secrets, options.secretsBackend)
    let port: number | undefined
    const upstream = new UpstreamManager({
      catalog,
      secrets,
      log: log.child('upstream'),
      version,
      oauthRedirectUrl: () => (port ? `http://127.0.0.1:${port}/oauth/callback` : undefined),
    })
    await upstream.apply(config.config)
    const views = new ProfileViews(() => ({ config: config.config, revision: config.revision }), catalog)
    const audit = new AuditLog(paths.audit, {
      persist: () => config.config.settings.activityLog === true,
      retentionDays: () => config.config.settings.retentionDays,
    })
    const gateway = new Gateway(views, upstream, audit)
    const surfaces = await createSurfaces(gateway)
    const seen = await SeenClients.open(paths.seenClients)
    const sessions = new SessionRegistry({
      gateway,
      upstream,
      surfaces,
      seen,
      log: log.child('mcp'),
      version,
      resolve: (clientName) => {
        const r = resolveProfile({ clientName }, config.config)
        return r.ok && (r.via === 'client-rule' || r.via === 'default')
          ? { profile: r.profile, via: r.via }
          : undefined
      },
      adminUrl: () => `http://127.0.0.1:${port ?? brand.defaultPort}`,
    })
    const adminToken = await loadAdminToken(paths.adminToken)

    const daemon = new Daemon(
      paths,
      config,
      catalog,
      secrets,
      upstream,
      views,
      gateway,
      sessions,
      surfaces,
      seen,
      audit,
      adminToken,
      log,
      { ...options, version },
    )
    daemon.#wire()
    daemon.#onListen = (p) => {
      port = p
    }
    return daemon
  }

  get info(): DaemonInfo | undefined {
    return this.#info
  }

  get version(): string {
    return this.options.version ?? '0.0.0'
  }

  get clientEnv(): ClientEnv {
    return this.options.clientEnv ?? defaultClientEnv()
  }

  #wire(): void {
    this.config.on('change', (next) => {
      void this.upstream.apply(next).then(() => {
        this.sessions.notifyChanges()
        // New or changed servers are started now to discover their tools, so
        // profiles that use them update without waiting for a client to ask.
        return this.upstream.warm()
      })
    })
    this.catalog.on('change', () => this.sessions.notifyChanges())

    const app = this.app
    app.use('*', loopbackGuard(this.options.allowedHosts))
    app.get('/healthz', (c) => c.json({ ok: true, name: brand.name, version: this.version }))
    app.get('/oauth/callback', async (c) => {
      const state = c.req.query('state') ?? ''
      const code = c.req.query('code')
      const connection = this.upstream.list().find((s) => s.oauthState && s.oauthState === state)
      const page = (title: string, text: string, status: 200 | 400 = 200) =>
        c.html(
          `<!doctype html><meta charset="utf-8"><title>${brand.displayName}</title><body style="font:16px system-ui;margin:4rem auto;max-width:32rem"><h1>${title}</h1><p>${text}</p>`,
          status,
        )
      if (!connection || !code) {
        return page(
          'Sign-in failed',
          escapeHtml(
            c.req.query('error_description') ??
              'This sign-in link is not valid any more. Start again from Switchboard.',
          ),
          400,
        )
      }
      try {
        await connection.finishAuth(code)
        return page(`Signed in to ${escapeHtml(connection.name)}`, 'You can close this tab.')
      } catch (error) {
        return page('Sign-in failed', escapeHtml((error as Error).message), 400)
      }
    })
    app.route('/api', adminApi(this))
    this.options.extend?.(app, this)
    const handler = mcpHandler({ sessions: this.sessions, config: () => this.config.config, log: this.log })
    app.all('/p/:profile/mcp', handler)
    app.all('/mcp', handler)
    if (this.options.webRoot) app.route('/', webUi(this.options.webRoot, this.adminToken))
  }

  async listen(): Promise<DaemonInfo> {
    const host = this.options.host ?? brand.defaultHost
    const port = this.options.port ?? brand.defaultPort
    this.#server = await new Promise<ServerType>((resolve, reject) => {
      const server = serve({ fetch: this.app.fetch, port, hostname: host }, () => resolve(server))
      server.once('error', reject)
    })
    const address = this.#server.address() as AddressInfo
    this.#info = {
      pid: process.pid,
      port: address.port,
      host,
      version: this.version,
      startedAt: new Date().toISOString(),
    }
    this.#onListen?.(address.port)
    await writeJson(this.paths.pid, this.#info)
    this.config.watch()
    for (const connection of this.upstream.list()) connection.keepAlive()
    void this.audit
      .prune()
      .then(() => this.audit.load())
      .catch(() => undefined)
    this.#pruneTimer = setInterval(() => void this.audit.prune().catch(() => undefined), 6 * 60 * 60_000)
    this.#pruneTimer.unref()
    if (this.options.warmCatalog !== false) void this.upstream.warm()
    this.log.info(
      `${brand.displayName} listening on http://${host === '::1' ? '[::1]' : host}:${address.port}`,
    )
    return this.#info
  }

  /**
   * Shut down quickly: stop accepting connections and drop open ones (the
   * web UI's event stream and clients' MCP streams never end on their own),
   * end sessions, and stop servers without waiting for them politely.
   */
  async close(): Promise<void> {
    clearInterval(this.#pruneTimer)
    this.config.close()
    const server = this.#server as (ServerType & { closeAllConnections?: () => void }) | undefined
    const closed = new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
    await this.sessions.closeAll()
    server?.closeAllConnections?.()
    await Promise.race([closed, new Promise((r) => setTimeout(r, 1000).unref())])
    await this.upstream.stopAll({ fast: true })
    await this.catalog.flush()
    await this.audit.flush()
    await this.seen.flush()
    await rm(this.paths.pid, { force: true })
  }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)
}

async function createSurfaces(gateway: Gateway): Promise<Record<ConcreteSurface, ToolSurface>> {
  const passthrough = passthroughSurface({ gateway })
  return { passthrough, meta: metaSurface({ gateway }), code: codeSurface({ gateway }) }
}

/** The token that protects the admin API, created on first start and readable only by the user. */
async function loadAdminToken(path: string): Promise<string> {
  try {
    const token = (await readFile(path, 'utf8')).trim()
    if (token) return token
  } catch {}
  const token = randomBytes(24).toString('base64url')
  await writeFileAtomic(path, `${token}\n`, 0o600)
  return token
}
