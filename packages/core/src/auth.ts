import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { readJson, writeJson } from './fs.ts'

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>

const sha256 = (text: string) => createHash('sha256').update(text).digest()

function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b)
}

/** The prefix of every API key, so they are easy to recognise and to scan for in leaks. */
export const KEY_PREFIX = 'sbk_'

export interface ApiKey {
  id: string
  /** The client this key identifies: its profile is the client's profile. */
  client: string
  label?: string
  /** sha256 of the secret part, hex. */
  hash: string
  createdAt: string
  lastUsedAt?: string
}

export type PublicApiKey = Omit<ApiKey, 'hash'>

/**
 * API keys for MCP clients, kept hashed in keys.json. A key is shown once,
 * when it is created: `sbk_<id>_<secret>`.
 */
export class KeyStore {
  #keys = new Map<string, ApiKey>()
  #saveTimer?: NodeJS.Timeout

  private constructor(private readonly path?: string) {}

  static async open(path?: string): Promise<KeyStore> {
    const store = new KeyStore(path)
    if (path)
      for (const key of (await readJson<ApiKey[]>(path).catch(() => undefined)) ?? [])
        store.#keys.set(key.id, key)
    return store
  }

  get size(): number {
    return this.#keys.size
  }

  list(): PublicApiKey[] {
    return [...this.#keys.values()].map(({ hash: _hash, ...key }) => key)
  }

  async create(client: string, label?: string): Promise<{ token: string; key: PublicApiKey }> {
    const id = randomBytes(6).toString('hex')
    const secret = randomBytes(24).toString('base64url')
    const key: ApiKey = {
      id,
      client,
      label,
      hash: sha256(secret).toString('hex'),
      createdAt: new Date().toISOString(),
    }
    this.#keys.set(id, key)
    await this.flush()
    const { hash: _hash, ...visible } = key
    return { token: `${KEY_PREFIX}${id}_${secret}`, key: visible }
  }

  async remove(id: string): Promise<boolean> {
    const removed = this.#keys.delete(id)
    if (removed) await this.flush()
    return removed
  }

  /** The key a bearer token belongs to, or undefined. Constant-time on the secret. */
  verify(token: string): ApiKey | undefined {
    if (!token.startsWith(KEY_PREFIX)) return undefined
    const rest = token.slice(KEY_PREFIX.length)
    const split = rest.indexOf('_')
    if (split <= 0) return undefined
    const key = this.#keys.get(rest.slice(0, split))
    if (!key) return undefined
    if (!safeEqual(sha256(rest.slice(split + 1)), Buffer.from(key.hash, 'hex'))) return undefined
    key.lastUsedAt = new Date().toISOString()
    this.#scheduleSave()
    return key
  }

  async flush(): Promise<void> {
    clearTimeout(this.#saveTimer)
    this.#saveTimer = undefined
    if (this.path) await writeJson(this.path, [...this.#keys.values()], 0o600)
  }

  #scheduleSave(): void {
    if (!this.path || this.#saveTimer) return
    this.#saveTimer = setTimeout(() => {
      this.#saveTimer = undefined
      void this.flush().catch(() => undefined)
    }, 5000)
    this.#saveTimer.unref()
  }
}

interface PasswordFile {
  algorithm: 'scrypt'
  salt: string
  hash: string
}

/** The admin password, from SWITCHBOARD_ADMIN_PASSWORD or an scrypt hash in admin.json. */
export class AdminPassword {
  private constructor(
    private readonly path: string,
    private stored: PasswordFile | undefined,
    private readonly fromEnv: string | undefined,
  ) {}

  static async open(path: string, fromEnv?: string): Promise<AdminPassword> {
    return new AdminPassword(
      path,
      await readJson<PasswordFile>(path).catch(() => undefined),
      fromEnv || undefined,
    )
  }

  get isSet(): boolean {
    return !!this.fromEnv || !!this.stored
  }

  async set(password: string): Promise<void> {
    const salt = randomBytes(16)
    const hash = await scrypt(password, salt, 32)
    this.stored = { algorithm: 'scrypt', salt: salt.toString('hex'), hash: hash.toString('hex') }
    await writeJson(this.path, this.stored, 0o600)
  }

  async verify(password: string): Promise<boolean> {
    if (this.fromEnv) return safeEqual(sha256(password), sha256(this.fromEnv))
    if (!this.stored) return false
    const hash = await scrypt(password, Buffer.from(this.stored.salt, 'hex'), 32)
    return safeEqual(hash, Buffer.from(this.stored.hash, 'hex'))
  }
}

/** Browser sessions for the web UI after logging in with the admin password. */
export class AdminSessions {
  #sessions = new Map<string, number>()

  constructor(private readonly ttlMs = 12 * 60 * 60 * 1000) {}

  create(): string {
    const id = randomBytes(32).toString('base64url')
    this.#sessions.set(id, Date.now() + this.ttlMs)
    return id
  }

  verify(id: string | undefined): boolean {
    if (!id) return false
    const expires = this.#sessions.get(id)
    if (!expires) return false
    if (expires < Date.now()) {
      this.#sessions.delete(id)
      return false
    }
    // Sliding expiry while the UI is in use.
    this.#sessions.set(id, Date.now() + this.ttlMs)
    return true
  }

  remove(id: string | undefined): void {
    if (id) this.#sessions.delete(id)
  }
}

/** A fixed-window limit per key, for login attempts. */
export class RateLimiter {
  #hits = new Map<string, { count: number; resetAt: number }>()

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  take(key: string): boolean {
    const now = Date.now()
    const entry = this.#hits.get(key)
    if (!entry || entry.resetAt < now) {
      this.#hits.set(key, { count: 1, resetAt: now + this.windowMs })
      return true
    }
    entry.count++
    return entry.count <= this.limit
  }
}
