/**
 * Run a daemon from source that serves the built UI (apps/web/dist), with its
 * state in a temporary directory so the real setup is never touched.
 *
 *   pnpm --filter @switchboard/web build
 *   pnpm --filter @switchboard/web daemon
 *
 * SWITCHBOARD_HOME and SWITCHBOARD_PORT override the state directory and port
 * (default: a fresh temp dir and 7691). AI client config files are looked up
 * under <home>/client-home, never in your real home directory.
 */
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLogger, Daemon } from '@switchboard/core'
import { brand, brandEnv, type ConfigInput } from '@switchboard/shared'

const webRoot = fileURLToPath(new URL('../dist', import.meta.url))
const fixture = fileURLToPath(
  new URL('../../../packages/core/test/fixtures/test-server.mjs', import.meta.url),
)

const home = brandEnv('HOME') ?? (await mkdtemp(join(tmpdir(), `${brand.name}-web-`)))
const port = Number(brandEnv('PORT') ?? 7691)
const clientHome = join(home, 'client-home')

await mkdir(home, { recursive: true })
if (!existsSync(join(home, 'config.json'))) {
  const config: ConfigInput = {
    servers: {
      alpha: { transport: 'stdio', command: process.execPath, args: [fixture, 'alpha'] },
    },
    profiles: { dev: { description: 'Seeded by dev-daemon', servers: ['alpha'] } },
    defaultProfile: 'dev',
  }
  await writeFile(join(home, 'config.json'), `${JSON.stringify(config, null, 2)}\n`)
  // A fake Cursor config so the Import and Clients pages have something to show.
  await mkdir(join(clientHome, '.cursor'), { recursive: true })
  await writeFile(
    join(clientHome, '.cursor', 'mcp.json'),
    `${JSON.stringify({ mcpServers: { beta: { command: process.execPath, args: [fixture, 'beta'] } } }, null, 2)}\n`,
  )
}
if (!existsSync(join(webRoot, 'index.html'))) {
  console.warn(`No build in ${webRoot}; run \`pnpm --filter @switchboard/web build\` first.`)
}

const daemon = await Daemon.create({
  home,
  port,
  logger: createLogger(),
  secretsBackend: 'file',
  webRoot,
  clientEnv: { home: clientHome, platform: process.platform },
})
const info = await daemon.listen()
console.log(`State: ${home}\nUI:    http://127.0.0.1:${info.port}/`)

let closing = false
const stop = async () => {
  if (closing) return
  closing = true
  // Open event streams from a browser tab keep the HTTP server from closing.
  setTimeout(() => process.exit(0), 3000).unref()
  await daemon.close()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
