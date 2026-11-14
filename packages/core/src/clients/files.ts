import { copyFile, mkdir, readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { brand, type ServerConfigInput, slugSchema } from '@switchboard/shared'
import { applyEdits, modify, type ParseError, parse as parseJsonc } from 'jsonc-parser'
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'
import { writeFileAtomic } from '../fs.ts'
import { CLIENTS, type ClientDef, type ClientEnv, type ConnectTarget, findClient } from './registry.ts'

export const ENTRY_NAME = brand.name

export interface ClientState {
  id: string
  name: string
  installed: boolean
  configPath: string
  configExists: boolean
  /** The profile Switchboard's entry points at, if there is one. */
  connectedProfile?: string
  /** Switchboard's entry exists but does not look like one it wrote. */
  foreignEntry?: boolean
  /** Other MCP servers in the file, which can be imported. */
  serverCount: number
  error?: string
  docs: string
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  )
}

async function configPath(client: ClientDef, env: ClientEnv): Promise<string> {
  const candidates = client.paths(env)
  for (const path of candidates) if (await exists(path)) return path
  return candidates[0]!
}

async function readDocument(
  client: ClientDef,
  path: string,
): Promise<{ text: string; data: Record<string, unknown> }> {
  let text = ''
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (!text.trim()) return { text, data: {} }
  if (client.format === 'toml') return { text, data: parseToml(text) as Record<string, unknown> }
  const errors: ParseError[] = []
  const data = parseJsonc(text, errors, { allowTrailingComma: true }) as Record<string, unknown>
  if (errors.length) throw new Error(`${path} is not valid JSON`)
  return { text, data: data ?? {} }
}

function serversOf(
  client: ClientDef,
  data: Record<string, unknown>,
): Record<string, Record<string, unknown>> {
  let node: unknown = data
  for (const key of client.key) node = (node as Record<string, unknown> | undefined)?.[key]
  return node && typeof node === 'object' ? (node as Record<string, Record<string, unknown>>) : {}
}

/** Which profile an entry we wrote points at. */
export function profileOfEntry(entry: Record<string, unknown>): string | undefined {
  const url = (entry.url ?? entry.serverUrl ?? entry.httpUrl) as string | undefined
  if (url) return url.match(/\/p\/([^/]+)\/mcp\/?$/)?.[1]
  const args = entry.args as string[] | undefined
  if (Array.isArray(args) && args.includes('connect')) {
    const i = args.indexOf('--profile')
    return i >= 0 ? args[i + 1] : undefined
  }
  return undefined
}

export async function clientState(client: ClientDef, env: ClientEnv): Promise<ClientState> {
  const path = await configPath(client, env)
  const state: ClientState = {
    id: client.id,
    name: client.name,
    installed: (await Promise.all(client.detect(env).map(exists))).some(Boolean),
    configPath: path,
    configExists: await exists(path),
    serverCount: 0,
    docs: client.docs,
  }
  try {
    const { data } = await readDocument(client, path)
    const servers = serversOf(client, data)
    const ours = servers[ENTRY_NAME]
    if (ours) {
      state.connectedProfile = profileOfEntry(ours)
      state.foreignEntry = !state.connectedProfile
    }
    state.serverCount = Object.keys(servers).filter((n) => n !== ENTRY_NAME).length
  } catch (error) {
    state.error = (error as Error).message
  }
  return state
}

export function listClients(env: ClientEnv): Promise<ClientState[]> {
  return Promise.all(CLIENTS.map((c) => clientState(c, env)))
}

async function backup(path: string, backupsDir: string): Promise<string | undefined> {
  if (!(await exists(path))) return undefined
  await mkdir(backupsDir, { recursive: true, mode: 0o700 })
  const target = join(backupsDir, `${basename(path)}.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`)
  await copyFile(path, target)
  return target
}

async function writeEntry(
  client: ClientDef,
  env: ClientEnv,
  backupsDir: string,
  value: Record<string, unknown> | undefined,
): Promise<{ path: string; backup?: string }> {
  const path = await configPath(client, env)
  const { text, data } = await readDocument(client, path)
  const existing = serversOf(client, data)[ENTRY_NAME]
  if (existing && !profileOfEntry(existing)) {
    throw new Error(
      `${path} already has a "${ENTRY_NAME}" entry that ${brand.displayName} did not write. Rename or remove it first.`,
    )
  }
  if (!value && !existing) return { path }
  const saved = await backup(path, backupsDir)
  let next: string
  if (client.format === 'toml') {
    let node = data as Record<string, unknown>
    for (const key of client.key) {
      node[key] ??= {}
      node = node[key] as Record<string, unknown>
    }
    if (value) node[ENTRY_NAME] = value
    else delete node[ENTRY_NAME]
    next = stringifyToml(data)
  } else {
    // Edit in place so comments and formatting in the user's file survive.
    const edits = modify(text || '{}', [...client.key, ENTRY_NAME], value, {
      formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' },
    })
    next = applyEdits(text || '{}', edits)
  }
  await writeFileAtomic(path, next.endsWith('\n') ? next : `${next}\n`, 0o600)
  return { path, backup: saved }
}

export function connectClient(id: string, target: ConnectTarget, env: ClientEnv, backupsDir: string) {
  const client = findClient(id)
  if (!client)
    throw new Error(`Unknown client "${id}". Known clients: ${CLIENTS.map((c) => c.id).join(', ')}.`)
  return writeEntry(client, env, backupsDir, client.entry(target))
}

export function disconnectClient(id: string, env: ClientEnv, backupsDir: string) {
  const client = findClient(id)
  if (!client) throw new Error(`Unknown client "${id}".`)
  return writeEntry(client, env, backupsDir, undefined)
}

export interface ImportCandidate {
  client: string
  /** The name in the client's file. */
  originalName: string
  /** A valid Switchboard server name. */
  name: string
  server: ServerConfigInput
}

export function toSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 48)
  return slugSchema.safeParse(slug).success ? slug : `server-${slug || 'x'}`.slice(0, 48)
}

/** Convert a client's server entry to Switchboard's format, or undefined if it cannot be. */
export function toServerConfig(entry: Record<string, unknown>): ServerConfigInput | undefined {
  const strings = (v: unknown) =>
    v && typeof v === 'object'
      ? (Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'string')) as Record<
          string,
          string
        >)
      : {}
  if (typeof entry.command === 'string') {
    return {
      transport: 'stdio',
      command: entry.command,
      args: Array.isArray(entry.args) ? entry.args.map(String) : [],
      env: strings(entry.env),
      ...(typeof entry.cwd === 'string' ? { cwd: entry.cwd } : {}),
      enabled: entry.disabled !== true && entry.enabled !== false,
    }
  }
  const url = entry.url ?? entry.serverUrl ?? entry.httpUrl
  if (typeof url !== 'string') return undefined
  const type = String(entry.type ?? entry.transport ?? '')
  return {
    transport: type === 'sse' ? 'sse' : 'http',
    url,
    headers: strings(entry.headers),
    enabled: entry.disabled !== true && entry.enabled !== false,
  }
}

export async function importCandidates(env: ClientEnv): Promise<ImportCandidate[]> {
  const out: ImportCandidate[] = []
  for (const client of CLIENTS) {
    const path = await configPath(client, env)
    let data: Record<string, unknown>
    try {
      data = (await readDocument(client, path)).data
    } catch {
      continue
    }
    for (const [originalName, entry] of Object.entries(serversOf(client, data))) {
      if (originalName === ENTRY_NAME || !entry || typeof entry !== 'object') continue
      const server = toServerConfig(entry)
      if (server) out.push({ client: client.id, originalName, name: toSlug(originalName), server })
    }
  }
  return out
}
