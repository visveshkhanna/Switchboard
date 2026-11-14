import { EventEmitter } from 'node:events'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { readJson, writeJson } from './fs.ts'

export interface ServerCatalog {
  tools: Tool[]
  /** Server-provided instructions from `initialize`. */
  instructions?: string
  serverVersion?: { name: string; version: string }
  syncedAt: string
  /** Hash of the server's config when synced; a config change makes the entry stale. */
  configHash: string
}

interface CatalogFile {
  version: 1
  servers: Record<string, ServerCatalog>
}

export interface CatalogEvents {
  change: [server: string]
}

/**
 * The last known tools of every server, kept on disk so tools/list can be
 * answered without starting anything.
 */
export class Catalog extends EventEmitter<CatalogEvents> {
  #servers = new Map<string, ServerCatalog>()
  #revision = 0
  #saveTimer?: NodeJS.Timeout

  constructor(private readonly path?: string) {
    super()
  }

  static async open(path: string): Promise<Catalog> {
    const catalog = new Catalog(path)
    const file = await readJson<CatalogFile>(path).catch(() => undefined)
    if (file?.version === 1) {
      for (const [name, entry] of Object.entries(file.servers)) catalog.#servers.set(name, entry)
    }
    return catalog
  }

  get revision(): number {
    return this.#revision
  }

  get(server: string): ServerCatalog | undefined {
    return this.#servers.get(server)
  }

  has(server: string, configHash?: string): boolean {
    const entry = this.#servers.get(server)
    return !!entry && (configHash === undefined || entry.configHash === configHash)
  }

  set(server: string, entry: ServerCatalog): void {
    const previous = this.#servers.get(server)
    this.#servers.set(server, entry)
    if (previous && JSON.stringify(previous.tools) === JSON.stringify(entry.tools)) {
      this.#scheduleSave()
      return
    }
    this.#revision++
    this.#scheduleSave()
    this.emit('change', server)
  }

  delete(server: string): void {
    if (!this.#servers.delete(server)) return
    this.#revision++
    this.#scheduleSave()
    this.emit('change', server)
  }

  servers(): string[] {
    return [...this.#servers.keys()]
  }

  async flush(): Promise<void> {
    clearTimeout(this.#saveTimer)
    this.#saveTimer = undefined
    if (!this.path) return
    const file: CatalogFile = { version: 1, servers: Object.fromEntries(this.#servers) }
    await writeJson(this.path, file)
  }

  #scheduleSave(): void {
    if (!this.path || this.#saveTimer) return
    this.#saveTimer = setTimeout(() => {
      this.#saveTimer = undefined
      void this.flush()
    }, 250)
    this.#saveTimer.unref()
  }
}
