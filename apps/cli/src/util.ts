import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { ConfigStore, type DaemonInfo, type Paths, readJson, resolvePaths } from '@switchboard/core'
import { brand, brandEnv } from '@switchboard/shared'

declare const __SWITCHBOARD_VERSION__: string
export const VERSION = typeof __SWITCHBOARD_VERSION__ === 'string' ? __SWITCHBOARD_VERSION__ : '0.0.0-dev'

const color = process.stdout.isTTY && !process.env.NO_COLOR
const paint = (code: number) => (text: string) => (color ? `\x1b[${code}m${text}\x1b[0m` : text)
export const bold = paint(1)
export const dim = paint(2)
export const red = paint(31)
export const green = paint(32)
export const yellow = paint(33)
export const cyan = paint(36)

export class UsageError extends Error {}

export function paths(): Paths {
  return resolvePaths()
}

export function defaultPort(): number {
  const fromEnv = Number(brandEnv('PORT'))
  return Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : brand.defaultPort
}

export function openConfig(): Promise<ConfigStore> {
  return ConfigStore.open(paths().config)
}

export function table(rows: string[][], header?: string[]): string {
  const all = header ? [header, ...rows] : rows
  // biome-ignore lint/suspicious/noControlCharactersInRegex: strips ANSI colors to measure width
  const width = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '').length
  const widths = all[0]?.map((_, i) => Math.max(...all.map((r) => width(r[i] ?? '')))) ?? []
  const line = (r: string[]) =>
    r
      .map((cell, i) => (i === r.length - 1 ? cell : cell + ' '.repeat(widths[i]! - width(cell))))
      .join('  ')
      .trimEnd()
  const out = rows.map(line)
  if (header) out.unshift(bold(line(header)))
  return out.join('\n')
}

/** The running daemon, if its pid file points at a live, healthy process. */
export async function runningDaemon(): Promise<(DaemonInfo & { url: string }) | undefined> {
  const info = await readJson<DaemonInfo>(paths().pid).catch(() => undefined)
  if (!info) return undefined
  try {
    process.kill(info.pid, 0)
  } catch {
    return undefined
  }
  const url = `http://127.0.0.1:${info.port}`
  try {
    const res = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(1500) })
    if (!res.ok) return undefined
  } catch {
    return undefined
  }
  return { ...info, url }
}

export async function adminToken(): Promise<string> {
  return (await readFile(paths().adminToken, 'utf8')).trim()
}

/** Call the admin API of the running daemon. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const daemon = await runningDaemon()
  if (!daemon)
    throw new UsageError(`${brand.displayName} is not running. Start it with \`${brand.name} up\`.`)
  const res = await fetch(`${daemon.url}/api${path}`, {
    method: init.method ?? 'GET',
    headers: { authorization: `Bearer ${await adminToken()}`, 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const body = (await res.json()) as T & { error?: string; problems?: string[] }
  if (!res.ok) {
    throw new Error([body.error, ...(body.problems ?? []).map((p) => `  - ${p}`)].filter(Boolean).join('\n'))
  }
  return body
}

export function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]]
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true })
      .on('error', () => undefined)
      .unref()
  } catch {}
}

/** Parse `KEY=VALUE` pairs. */
export function keyValues(items: string[] | undefined, what: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const item of items ?? []) {
    const i = item.indexOf('=')
    if (i <= 0) throw new UsageError(`${what} must look like KEY=VALUE, got "${item}"`)
    out[item.slice(0, i)] = item.slice(i + 1)
  }
  return out
}

export function list(value: string | string[] | undefined): string[] {
  const items = Array.isArray(value) ? value : value ? [value] : []
  return items
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter(Boolean)
}
