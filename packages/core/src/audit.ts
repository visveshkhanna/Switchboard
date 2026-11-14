import { EventEmitter } from 'node:events'
import { appendFile, mkdir, readFile, rename, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { writeFileAtomic } from './fs.ts'

export interface AuditEvent {
  ts: string
  session?: string
  client?: string
  profile: string
  /** `server.tool`, or the requested name when it did not resolve to a tool. */
  tool: string
  server?: string
  /** How the call was made: directly, through call_tool, or from code mode. */
  via: 'direct' | 'call_tool' | 'code'
  durationMs: number
  ok: boolean
  error?: string
}

export interface AuditEvents {
  event: [event: AuditEvent]
}

const MAX_FILE_BYTES = 50 * 1024 * 1024
const DAY_MS = 24 * 60 * 60 * 1000

export interface AuditOptions {
  /** Whether events are written to disk; checked on every event. */
  persist?: () => boolean
  retentionDays?: () => number
  capacity?: number
}

/**
 * Tool calls, kept in memory and, when the user has opted in, appended to
 * audit.jsonl. Arguments and results are never recorded.
 */
export class AuditLog extends EventEmitter<AuditEvents> {
  #events: AuditEvent[] = []
  #writing: Promise<void> = Promise.resolve()
  readonly #capacity: number

  constructor(
    private readonly path?: string,
    private readonly options: AuditOptions = {},
  ) {
    super()
    this.#capacity = options.capacity ?? 5000
  }

  get persisting(): boolean {
    return !!this.path && (this.options.persist?.() ?? true)
  }

  record(event: AuditEvent): void {
    if (!event.server && event.tool.includes('.')) event.server = event.tool.slice(0, event.tool.indexOf('.'))
    this.#events.push(event)
    if (this.#events.length > this.#capacity) this.#events.splice(0, this.#events.length - this.#capacity)
    this.emit('event', event)
    if (this.persisting) this.#writing = this.#writing.then(() => this.#append(event)).catch(() => undefined)
  }

  recent(limit = 200): AuditEvent[] {
    return this.#events.slice(-limit).reverse()
  }

  /** Events since a time: from disk when the log is kept, from memory otherwise. */
  async since(sinceMs: number): Promise<{ events: AuditEvent[]; source: 'file' | 'memory' }> {
    if (!this.persisting) {
      return { events: this.#events.filter((e) => Date.parse(e.ts) >= sinceMs), source: 'memory' }
    }
    await this.#writing
    const events: AuditEvent[] = []
    for (const file of [`${this.path}.1`, this.path!]) {
      const text = await readFile(file, 'utf8').catch(() => '')
      for (const line of text.split('\n')) {
        if (!line) continue
        try {
          const event = JSON.parse(line) as AuditEvent
          if (Date.parse(event.ts) >= sinceMs) events.push(event)
        } catch {}
      }
    }
    return { events, source: 'file' }
  }

  /** Drop events older than the retention period from disk. */
  async prune(): Promise<void> {
    if (!this.path) return
    const days = this.options.retentionDays?.() ?? 30
    const cutoff = Date.now() - days * DAY_MS
    await this.#writing
    for (const file of [`${this.path}.1`, this.path]) {
      const text = await readFile(file, 'utf8').catch(() => undefined)
      if (text === undefined) continue
      const kept = text.split('\n').filter((line) => {
        if (!line) return false
        try {
          return Date.parse((JSON.parse(line) as AuditEvent).ts) >= cutoff
        } catch {
          return false
        }
      })
      await writeFileAtomic(file, kept.length ? `${kept.join('\n')}\n` : '')
    }
  }

  flush(): Promise<void> {
    return this.#writing
  }

  async #append(event: AuditEvent): Promise<void> {
    const path = this.path!
    await mkdir(dirname(path), { recursive: true })
    const size = await stat(path).then(
      (s) => s.size,
      () => 0,
    )
    if (size > MAX_FILE_BYTES) await rename(path, `${path}.1`)
    await appendFile(path, `${JSON.stringify(event)}\n`, { mode: 0o600 })
  }
}
