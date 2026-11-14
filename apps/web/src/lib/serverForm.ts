import type { ServerConfig } from '@switchboard/shared'
import { fromKV, type KV, toKV } from './kv.tsx'

export interface ServerForm {
  name: string
  description: string
  enabled: boolean
  transport: ServerConfig['transport']
  command: string
  args: string
  env: KV[]
  cwd: string
  url: string
  headers: KV[]
  idleTimeoutSec: string
  callTimeoutSec: string
}

export const emptyForm: ServerForm = {
  name: '',
  description: '',
  enabled: true,
  transport: 'stdio',
  command: '',
  args: '',
  env: [],
  cwd: '',
  url: '',
  headers: [],
  idleTimeoutSec: '600',
  callTimeoutSec: '120',
}

export function formFromConfig(name: string, c: ServerConfig): ServerForm {
  const base = {
    ...emptyForm,
    name,
    description: c.description ?? '',
    enabled: c.enabled,
    transport: c.transport,
    idleTimeoutSec: String(c.idleTimeoutSec),
    callTimeoutSec: String(c.callTimeoutSec),
  }
  if (c.transport === 'stdio') {
    return { ...base, command: c.command, args: c.args.join('\n'), env: toKV(c.env), cwd: c.cwd ?? '' }
  }
  return { ...base, url: c.url, headers: toKV(c.headers) }
}

const int = (s: string): number | undefined => (s.trim() === '' ? undefined : Number(s))

/** The body for PUT /api/servers/:name. The daemon fills defaults and validates. */
export function configFromForm(f: ServerForm): Record<string, unknown> {
  const common = {
    enabled: f.enabled,
    ...(f.description.trim() ? { description: f.description.trim() } : {}),
    ...(int(f.idleTimeoutSec) !== undefined ? { idleTimeoutSec: int(f.idleTimeoutSec) } : {}),
    ...(int(f.callTimeoutSec) !== undefined ? { callTimeoutSec: int(f.callTimeoutSec) } : {}),
  }
  if (f.transport === 'stdio') {
    return {
      ...common,
      transport: 'stdio',
      command: f.command.trim(),
      args: f.args.split('\n').filter((a) => a.trim() !== ''),
      env: fromKV(f.env),
      ...(f.cwd.trim() ? { cwd: f.cwd.trim() } : {}),
    }
  }
  return { ...common, transport: f.transport, url: f.url.trim(), headers: fromKV(f.headers) }
}

const strings = (v: unknown): Record<string, string> =>
  v && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => typeof e[1] === 'string'))
    : {}

const isEntry = (v: unknown): v is Record<string, unknown> =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  (typeof (v as Record<string, unknown>).command === 'string' ||
    typeof (v as Record<string, unknown>).url === 'string' ||
    typeof (v as Record<string, unknown>).serverUrl === 'string' ||
    typeof (v as Record<string, unknown>).httpUrl === 'string')

/**
 * Read a server entry copied from a client's config: a bare entry
 * (`{"command": …}` / `{"url": …}`), `{"name": entry}`, or a whole
 * `{"mcpServers": {…}}` / `{"servers": {…}}` block (the first entry is used).
 */
export function parsePastedEntry(text: string): { name?: string; form: Partial<ServerForm> } {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (e) {
    throw new Error(`Not valid JSON: ${(e as Error).message}`)
  }
  let name: string | undefined
  if (!isEntry(data) && data && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    const container = (obj.mcpServers ?? obj.servers ?? obj.mcp_servers ?? obj) as Record<string, unknown>
    const first = Object.entries(container ?? {}).find(([, v]) => isEntry(v))
    if (first) {
      name = first[0]
      data = first[1]
    }
  }
  if (!isEntry(data)) {
    throw new Error(
      'Expected an entry with "command" (stdio) or "url" (HTTP), like {"command": "npx", "args": […]}.',
    )
  }
  const e = data
  const enabled = e.disabled !== true && e.enabled !== false
  const slug = name
    ?.toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 48)
  if (typeof e.command === 'string') {
    return {
      name: slug,
      form: {
        transport: 'stdio',
        enabled,
        command: e.command,
        args: Array.isArray(e.args) ? e.args.map(String).join('\n') : '',
        env: toKV(strings(e.env)),
        cwd: typeof e.cwd === 'string' ? e.cwd : '',
      },
    }
  }
  const type = String(e.type ?? e.transport ?? '')
  return {
    name: slug,
    form: {
      transport: type === 'sse' ? 'sse' : 'http',
      enabled,
      url: String(e.url ?? e.serverUrl ?? e.httpUrl),
      headers: toKV(strings(e.headers)),
    },
  }
}

const SECRET_RE = /secret:\/\/([A-Za-z0-9_.-]+)/g

export function secretRefs(f: ServerForm): string[] {
  const values = [...f.env, ...f.headers].map((r) => r.value).concat(f.args, f.url)
  const names = new Set<string>()
  for (const v of values) for (const m of v.matchAll(SECRET_RE)) names.add(m[1]!)
  return [...names]
}

export function summary(c: ServerConfig): string {
  return c.transport === 'stdio' ? [c.command, ...c.args].join(' ') : c.url
}
