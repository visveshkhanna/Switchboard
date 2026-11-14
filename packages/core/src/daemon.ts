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
import { ProfileViews } from './profiles/view.ts'
import { openSecretBackend, type SecretBackend } from './secrets.ts'
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
    const upstream = new UpstreamManager({ catalog, secrets, log: log.child('upstream'), version })
    await upstream.apply(config.config)
    const views = new ProfileViews(() => ({ config: config.config, revision: config.revision }), catalog)
    const audit = new AuditLog(paths.audit)
    const gateway = new Gateway(views, upstream, audit)
    const surfaces = await createSurfaces(gateway)
    const sessions = new SessionRegistry({ gateway, upstream, surfaces, log: log.child('mcp'), version })
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
      audit,
      adminToken,
      log,
      { ...options, version },
    )
    daemon.#wire()
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
      void this.upstream.apply(next).then(() => this.sessions.notifyChanges())
    })
    this.catalog.on('change', () => this.sessions.notifyChanges())

    const app = this.app
    app.use('*', loopbackGuard(this.options.allowedHosts))
    app.get('/healthz', (c) => c.json({ ok: true, name: brand.name, version: this.version }))
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
    await writeJson(this.paths.pid, this.#info)
    this.config.watch()
    if (this.options.warmCatalog !== false)
      void this.upstream.ensureCatalog(Object.keys(this.config.config.servers))
    this.log.info(
      `${brand.displayName} listening on http://${host === '::1' ? '[::1]' : host}:${address.port}`,
    )
    return this.#info
  }

  async close(): Promise<void> {
    this.config.close()
    await this.sessions.closeAll()
    await new Promise<void>((resolve) => (this.#server ? this.#server.close(() => resolve()) : resolve()))
    await this.upstream.stopAll()
    await this.catalog.flush()
    await this.audit.flush()
    await rm(this.paths.pid, { force: true })
  }
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
