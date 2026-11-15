import { EventEmitter } from 'node:events'
import { clientId } from '@switchboard/shared'
import { readJson, writeJson } from './fs.ts'

export type ResolvedVia =
  | 'path'
  | 'header'
  | 'client'
  | 'client-rule'
  | 'default'
  /** No profile matched: the client waits with no tools. */
  | 'unassigned'
  /** Every profile is switched off for this client. */
  | 'disabled'

export interface SeenClient {
  /** The client id: the /c/<id>/mcp path, or the slug of its MCP name. */
  id: string
  /** The MCP `clientInfo.name` it last connected with. */
  name?: string
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
 * Every client that has connected, by id, kept in seen-clients.json, so the
 * web UI can list clients Switchboard has no preset for and switch their
 * profile.
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
      const saved = await readJson<(SeenClient & { id?: string })[]>(path).catch(() => undefined)
      for (const client of saved ?? []) {
        // Files from 0.2 keyed clients by name only.
        const id = client.id ?? clientId(client.name ?? '')
        store.#clients.set(id, { ...client, id })
      }
    }
    return store
  }

  list(): SeenClient[] {
    return [...this.#clients.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))
  }

  get(id: string): SeenClient | undefined {
    return this.#clients.get(id)
  }

  record(
    id: string,
    name: string | undefined,
    version: string | undefined,
    via: ResolvedVia,
    profile: string | null,
  ): void {
    const now = new Date().toISOString()
    const existing = this.#clients.get(id)
    this.#clients.set(id, {
      id,
      name: name ?? existing?.name,
      version: version ?? existing?.version,
      firstSeen: existing?.firstSeen ?? now,
      lastSeen: now,
      lastVia: via,
      lastProfile: profile,
    })
    if (this.#clients.size > MAX_CLIENTS) {
      const oldest = this.list().at(-1)
      if (oldest) this.#clients.delete(oldest.id)
    }
    this.#changed()
  }

  forget(id: string): boolean {
    const removed = this.#clients.delete(id)
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
