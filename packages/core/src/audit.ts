import { EventEmitter } from 'node:events'
import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface AuditEvent {
  ts: string
  session?: string
  client?: string
  profile: string
  /** `server.tool`, or the meta tool name for meta/code surfaces. */
  tool: string
  /** How the call was made: directly, through call_tool, or from code mode. */
  via: 'direct' | 'call_tool' | 'code'
  durationMs: number
  ok: boolean
  error?: string
}

export interface AuditEvents {
  event: [event: AuditEvent]
}

const MAX_FILE_BYTES = 5 * 1024 * 1024

/** Recent tool calls in memory, appended to audit.jsonl. Arguments and results are never recorded. */
export class AuditLog extends EventEmitter<AuditEvents> {
  #events: AuditEvent[] = []
  #writing: Promise<void> = Promise.resolve()

  constructor(
    private readonly path?: string,
    private readonly capacity = 1000,
  ) {
    super()
  }

  record(event: AuditEvent): void {
    this.#events.push(event)
    if (this.#events.length > this.capacity) this.#events.splice(0, this.#events.length - this.capacity)
    this.emit('event', event)
    if (this.path) this.#writing = this.#writing.then(() => this.#append(event)).catch(() => undefined)
  }

  recent(limit = 200): AuditEvent[] {
    return this.#events.slice(-limit).reverse()
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
