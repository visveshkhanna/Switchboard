import { brand } from '@switchboard/shared'
import { readJson, writeJson } from './fs.ts'

export const SECRET_PREFIX = 'secret://'
const SECRET_REF = /secret:\/\/([A-Za-z0-9_.-]+)/g
/** `env://NAME` reads an environment variable of the daemon, e.g. a hosting platform's secrets. */
const ENV_REF = /env:\/\/([A-Za-z_][A-Za-z0-9_]*)/g

export interface SecretBackend {
  readonly kind: string
  get(name: string): Promise<string | undefined>
  set(name: string, value: string): Promise<void>
  delete(name: string): Promise<void>
  list(): Promise<string[]>
}

/** Secrets in a JSON file readable only by the user. Used when no keychain is available. */
export class FileSecretBackend implements SecretBackend {
  readonly kind = 'file'
  constructor(private readonly path: string) {}

  async #read(): Promise<Record<string, string>> {
    return (await readJson<Record<string, string>>(this.path)) ?? {}
  }
  async get(name: string) {
    return (await this.#read())[name]
  }
  async set(name: string, value: string) {
    const all = await this.#read()
    all[name] = value
    await writeJson(this.path, all, 0o600)
  }
  async delete(name: string) {
    const all = await this.#read()
    delete all[name]
    await writeJson(this.path, all, 0o600)
  }
  async list() {
    return Object.keys(await this.#read()).sort()
  }
}

interface KeyringModule {
  Entry: new (
    service: string,
    account: string,
  ) => {
    getPassword(): string | null
    setPassword(value: string): void
    deletePassword(): boolean
  }
}

/**
 * Secrets in the OS keychain (macOS Keychain, Windows Credential Manager,
 * Secret Service on Linux). The keychain cannot list entries, so the names
 * are kept in the file backend's index with empty values.
 */
export class KeychainSecretBackend implements SecretBackend {
  readonly kind = 'keychain'
  constructor(
    private readonly keyring: KeyringModule,
    private readonly index: FileSecretBackend,
  ) {}

  #entry(name: string) {
    return new this.keyring.Entry(brand.name, name)
  }
  async get(name: string) {
    return this.#entry(name).getPassword() ?? undefined
  }
  async set(name: string, value: string) {
    this.#entry(name).setPassword(value)
    await this.index.set(name, '')
  }
  async delete(name: string) {
    try {
      this.#entry(name).deletePassword()
    } catch {}
    await this.index.delete(name)
  }
  list() {
    return this.index.list()
  }
}

/** Use the OS keychain when `@napi-rs/keyring` loads, the file otherwise. */
export async function openSecretBackend(
  filePath: string,
  prefer: 'auto' | 'file' = 'auto',
): Promise<SecretBackend> {
  const file = new FileSecretBackend(filePath)
  if (prefer === 'file') return file
  try {
    const keyring = (await import('@napi-rs/keyring' as string)) as KeyringModule
    const probe = new keyring.Entry(brand.name, '__probe__')
    probe.getPassword()
    return new KeychainSecretBackend(keyring, new FileSecretBackend(`${filePath}.index`))
  } catch {
    return file
  }
}

export class MissingSecretError extends Error {
  constructor(readonly names: string[]) {
    super(
      `Missing secret${names.length > 1 ? 's' : ''}: ${names.join(', ')}. Set with \`${brand.name} secret set <name>\`.`,
    )
    this.name = 'MissingSecretError'
  }
}

export function secretRefs(value: string): string[] {
  return [...value.matchAll(SECRET_REF)].map((m) => m[1]!)
}

/** Replace every `secret://name` in the strings with its value. */
export async function resolveSecrets<T extends Record<string, string>>(
  values: T,
  backend: SecretBackend,
  env: NodeJS.ProcessEnv = process.env,
): Promise<T> {
  const names = new Set(Object.values(values).flatMap(secretRefs))
  const envNames = new Set(Object.values(values).flatMap((v) => [...v.matchAll(ENV_REF)].map((m) => m[1]!)))
  if (!names.size && !envNames.size) return values
  const resolved = new Map<string, string>()
  const missing: string[] = []
  for (const name of names) {
    const value = await backend.get(name)
    if (value === undefined) missing.push(name)
    else resolved.set(name, value)
  }
  for (const name of envNames) {
    if (env[name] === undefined) missing.push(`env://${name}`)
  }
  if (missing.length) throw new MissingSecretError(missing)
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(values)) {
    out[key] = value
      .replace(SECRET_REF, (_, name: string) => resolved.get(name)!)
      .replace(ENV_REF, (_, name: string) => env[name]!)
  }
  return out as T
}

export async function resolveSecretList(values: string[], backend: SecretBackend): Promise<string[]> {
  const record = Object.fromEntries(values.map((v, i) => [String(i), v]))
  const resolved = await resolveSecrets(record, backend)
  return values.map((_, i) => resolved[String(i)]!)
}
