import { EventEmitter } from 'node:events'
import { readJson, writeJson } from './fs.ts'

export type ResolvedVia = 'path' | 'header' | 'client-rule' | 'default' | 'unassigned'

export interface SeenClient {
  /** The MCP `clientInfo.name`. */
  name: string
  version?: string
  firstSeen: string
  lastSeen: string
  lastVia: ResolvedVia
  lastProfile: string | null
}

export interface SeenClientsEvents {
  change: []
}

const MAX_CLIENTS = 200

/**
 * Every MCP client that has connected, by name, kept in seen-clients.json.
 * It lets the web UI show clients Switchboard has no preset for, and assign
 * them a profile.
 */
export class SeenClients extends EventEmitter<SeenClientsEvents> {
  #clients = new Map<string, SeenClient>()
  #saveTimer?: NodeJS.Timeout

  private constructor(private readonly path?: string) {
    super()
  }

  static async open(path?: string): Promise<SeenClients> {
    const store = new SeenClients(path)
    if (path) {
      const saved = await readJson<SeenClient[]>(path).catch(() => undefined)
      for (const client of saved ?? []) store.#clients.set(client.name, client)
    }
    return store
  }

  list(): SeenClient[] {
    return [...this.#clients.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))
  }

  get(name: string): SeenClient | undefined {
    return this.#clients.get(name)
  }

  record(name: string, version: string | undefined, via: ResolvedVia, profile: string | null): void {
    const now = new Date().toISOString()
    const existing = this.#clients.get(name)
    this.#clients.set(name, {
      name,
      version: version ?? existing?.version,
      firstSeen: existing?.firstSeen ?? now,
      lastSeen: now,
      lastVia: via,
      lastProfile: profile,
    })
    if (this.#clients.size > MAX_CLIENTS) {
      const oldest = this.list().at(-1)
      if (oldest) this.#clients.delete(oldest.name)
    }
    this.#changed()
  }

  forget(name: string): boolean {
    const removed = this.#clients.delete(name)
    if (removed) this.#changed()
    return removed
  }

  async flush(): Promise<void> {
    clearTimeout(this.#saveTimer)
    this.#saveTimer = undefined
    if (this.path) await writeJson(this.path, this.list())
  }

  #changed(): void {
    this.emit('change')
    if (!this.path || this.#saveTimer) return
    this.#saveTimer = setTimeout(() => {
      this.#saveTimer = undefined
      void this.flush().catch(() => undefined)
    }, 500)
    this.#saveTimer.unref()
  }
}
