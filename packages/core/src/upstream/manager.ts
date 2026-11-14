import { EventEmitter } from 'node:events'
import type { Config } from '@switchboard/shared'
import type { Catalog } from '../catalog.ts'
import type { Logger } from '../logger.ts'
import type { SecretBackend } from '../secrets.ts'
import { type ConnectionStatus, configHash, UpstreamConnection } from './connection.ts'

export interface ManagerEvents {
  status: [status: ConnectionStatus]
}

/** Owns one UpstreamConnection per configured server and keeps them in line with the config. */
export class UpstreamManager extends EventEmitter<ManagerEvents> {
  #connections = new Map<string, UpstreamConnection>()
  #syncing = new Map<string, Promise<void>>()

  constructor(
    private readonly deps: {
      catalog: Catalog
      secrets: SecretBackend
      log: Logger
      version: string
      oauthRedirectUrl?: () => string | undefined
    },
  ) {
    super()
  }

  get(name: string): UpstreamConnection | undefined {
    return this.#connections.get(name)
  }

  list(): UpstreamConnection[] {
    return [...this.#connections.values()]
  }

  statuses(): ConnectionStatus[] {
    return this.list().map((c) => c.status())
  }

  /** Add, replace and remove connections to match the config. */
  async apply(config: Config): Promise<void> {
    const stops: Promise<void>[] = []
    for (const [name, connection] of this.#connections) {
      const next = config.servers[name]
      if (!next || configHash(next) !== connection.hash) {
        this.#connections.delete(name)
        stops.push(connection.stop())
        if (!next) this.deps.catalog.delete(name)
      }
    }
    for (const [name, server] of Object.entries(config.servers)) {
      if (this.#connections.has(name)) continue
      const connection = new UpstreamConnection(name, server, {
        ...this.deps,
        log: this.deps.log.child(name),
      })
      connection.on('status', (status) => this.emit('status', status))
      this.#connections.set(name, connection)
    }
    await Promise.all(stops)
  }

  /**
   * Make sure the catalog has current tools for these servers, starting them
   * if it does not. Failures are logged; the server simply has no tools.
   */
  async ensureCatalog(names: string[]): Promise<void> {
    const stale = names.filter((name) => {
      const connection = this.#connections.get(name)
      return connection?.config.enabled && !this.deps.catalog.has(name, connection.hash)
    })
    await Promise.all(stale.map((name) => this.sync(name)))
  }

  /** Start a server and refresh its tools. Concurrent calls share one attempt. */
  sync(name: string): Promise<void> {
    const existing = this.#syncing.get(name)
    if (existing) return existing
    const connection = this.#connections.get(name)
    if (!connection) return Promise.resolve()
    const run = connection
      .sync()
      .then(() => undefined)
      .catch((error) => this.deps.log.warn(`could not list tools of ${name}: ${(error as Error).message}`))
      .finally(() => this.#syncing.delete(name))
    this.#syncing.set(name, run)
    return run
  }

  /** Start servers that should always run, and discover tools of any server not yet listed. */
  warm(): Promise<void> {
    for (const connection of this.#connections.values()) connection.keepAlive()
    return this.ensureCatalog([...this.#connections.keys()])
  }

  async stopAll(opts: { fast?: boolean } = {}): Promise<void> {
    await Promise.all(this.list().map((c) => c.stop(opts)))
  }
}
