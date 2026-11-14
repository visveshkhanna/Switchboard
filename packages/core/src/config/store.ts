import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { type FSWatcher, unwatchFile, watch, watchFile } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { type Config, ConfigError, parseConfig } from '@switchboard/shared'
import { writeFileAtomic } from '../fs.ts'
import type { Logger } from '../logger.ts'

const hash = (text: string) => createHash('sha256').update(text).digest('hex')

export interface ConfigStoreEvents {
  change: [config: Config, previous: Config]
  error: [error: Error]
}

/**
 * Holds the configuration in memory and keeps it in sync with config.json.
 * Every change, from the API or from someone editing the file, is validated
 * first: an invalid file is reported and the last good config stays live.
 */
export class ConfigStore extends EventEmitter<ConfigStoreEvents> {
  #config: Config
  #revision = 0
  #lastWrittenHash = ''
  #watcher?: FSWatcher
  #reloadTimer?: NodeJS.Timeout
  #queue: Promise<unknown> = Promise.resolve()

  private constructor(
    readonly path: string,
    config: Config,
    private readonly log?: Logger,
  ) {
    super()
    this.#config = config
  }

  static async open(path: string, log?: Logger): Promise<ConfigStore> {
    let text: string | undefined
    try {
      text = await readFile(path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const config = parseConfig(text ? JSON.parse(text) : {})
    const store = new ConfigStore(path, config, log)
    if (text === undefined) await store.#write(config)
    else store.#lastWrittenHash = hash(text)
    return store
  }

  get config(): Config {
    return this.#config
  }

  /** Increases on every change; caches key on it. */
  get revision(): number {
    return this.#revision
  }

  /** Apply a change. The updater gets a deep copy and returns the new config. */
  update(updater: (draft: Config) => Config | undefined): Promise<Config> {
    const run = async () => {
      const draft = structuredClone(this.#config)
      const next = parseConfig(updater(draft) ?? draft)
      await this.#write(next)
      this.#apply(next)
      return next
    }
    const result = this.#queue.then(run, run)
    this.#queue = result.catch(() => undefined)
    return result
  }

  /** Reload when the file changes on disk. */
  watch(): void {
    if (this.#watcher) return
    const file = basename(this.path)
    this.#watcher = watch(dirname(this.path), (_event, name) => {
      if (name !== file) return
      clearTimeout(this.#reloadTimer)
      this.#reloadTimer = setTimeout(() => void this.#reload(), 100)
    })
    this.#watcher.unref()
    // fs.watch can drop events on a busy system; polling once a second is a cheap backstop.
    watchFile(this.path, { interval: 1000, persistent: false }, () => {
      clearTimeout(this.#reloadTimer)
      this.#reloadTimer = setTimeout(() => void this.#reload(), 100)
    })
  }

  close(): void {
    clearTimeout(this.#reloadTimer)
    this.#watcher?.close()
    this.#watcher = undefined
    unwatchFile(this.path)
  }

  async #reload(): Promise<void> {
    let text: string
    try {
      text = await readFile(this.path, 'utf8')
    } catch {
      return
    }
    const digest = hash(text)
    if (digest === this.#lastWrittenHash) return
    try {
      const next = parseConfig(JSON.parse(text))
      this.#lastWrittenHash = digest
      this.#apply(next)
      this.log?.info('config reloaded from disk')
    } catch (error) {
      const message =
        error instanceof ConfigError ? error.message : `config.json: ${(error as Error).message}`
      this.log?.warn(`ignoring invalid config change: ${message}`)
      this.emit('error', new Error(message))
    }
  }

  async #write(config: Config): Promise<void> {
    const text = `${JSON.stringify(config, null, 2)}\n`
    this.#lastWrittenHash = hash(text)
    await writeFileAtomic(this.path, text)
  }

  #apply(next: Config): void {
    const previous = this.#config
    this.#config = next
    this.#revision++
    this.emit('change', next, previous)
  }
}
