import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { ConfigInput } from '@switchboard/shared'
import { Daemon, type DaemonOptions } from '../src/daemon.ts'
import { silentLogger } from '../src/logger.ts'

export const fixtureServer = fileURLToPath(new URL('./fixtures/test-server.mjs', import.meta.url))

export function stdioServer(name: string, extra: Record<string, unknown> = {}) {
  return { transport: 'stdio' as const, command: process.execPath, args: [fixtureServer, name], ...extra }
}

export interface TestDaemon {
  daemon: Daemon
  url: string
  home: string
  connect(
    path: string,
    opts?: { headers?: Record<string, string>; clientName?: string },
  ): Promise<{ client: Client; transport: StreamableHTTPClientTransport }>
  close(): Promise<void>
}

export async function startDaemon(config: ConfigInput, options: DaemonOptions = {}): Promise<TestDaemon> {
  const home = await mkdtemp(join(tmpdir(), 'switchboard-test-'))
  await writeFile(join(home, 'config.json'), JSON.stringify(config))
  const daemon = await Daemon.create({
    home,
    port: 0,
    logger: silentLogger,
    secretsBackend: 'file',
    warmCatalog: false,
    ...options,
  })
  const info = await daemon.listen()
  const url = `http://127.0.0.1:${info.port}`
  const clients: Client[] = []
  return {
    daemon,
    url,
    home,
    async connect(path, opts = {}) {
      const transport = new StreamableHTTPClientTransport(new URL(path, url), {
        requestInit: { headers: opts.headers ?? {} },
      })
      const client = new Client({ name: opts.clientName ?? 'vitest', version: '1.0.0' })
      await client.connect(transport)
      clients.push(client)
      return { client, transport }
    },
    async close() {
      await Promise.all(clients.map((c) => c.close().catch(() => undefined)))
      await daemon.close()
      await rm(home, { recursive: true, force: true })
    },
  }
}

export function text(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? []
  return content.map((c) => c.text ?? '').join('')
}

export async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error('waitFor timed out')
}
