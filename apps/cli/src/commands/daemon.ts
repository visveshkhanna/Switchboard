import { spawn } from 'node:child_process'
import { access, mkdir, open, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import {
  type ConnectionStatus,
  createLogger,
  Daemon,
  defaultClientEnv,
  type LogLevel,
  listClients,
  openSecretBackend,
  type SessionInfo,
  secretRefs,
} from '@switchboard/core'
import { brand, brandEnv, parseConfig } from '@switchboard/shared'
import {
  api,
  bold,
  cyan,
  defaultPort,
  dim,
  green,
  openBrowser,
  openConfig,
  paths,
  red,
  runningDaemon,
  table,
  UsageError,
  VERSION,
  yellow,
} from '../util.ts'

export function webRoot(): string | undefined {
  const dir = fileURLToPath(new URL('./web', import.meta.url))
  return dir
}

async function exists(path: string) {
  return access(path).then(
    () => true,
    () => false,
  )
}

export async function up(opts: {
  port?: string
  host?: string
  publicUrl?: string
  open?: boolean
  detach?: boolean
  log?: string
}) {
  const host = opts.host ?? brandEnv('HOST')
  const publicUrl = opts.publicUrl ?? brandEnv('PUBLIC_URL')
  if (publicUrl) {
    try {
      const u = new URL(publicUrl)
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error()
    } catch {
      throw new UsageError(`--public-url must be an http(s) URL, got "${publicUrl}".`)
    }
  }
  const running = await runningDaemon()
  if (running) {
    console.log(`${brand.displayName} is already running at ${cyan(running.url)} (pid ${running.pid}).`)
    if (opts.open) openBrowser(running.url)
    return
  }
  const port = opts.port ? Number(opts.port) : defaultPort()
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new UsageError(`Invalid port "${opts.port}"`)

  if (opts.detach) {
    await startDetached(port, host, publicUrl)
    const daemon = await waitForDaemon(10_000)
    if (!daemon)
      throw new Error(`${brand.displayName} did not start. See ${join(paths().logs, 'daemon.log')}.`)
    console.log(`${brand.displayName} is running at ${cyan(daemon.url)} (pid ${daemon.pid}).`)
    if (opts.open) openBrowser(daemon.url)
    return
  }

  await askAboutActivityLog()
  const root = webRoot()
  const daemon = await Daemon.create({
    port,
    host,
    publicUrl,
    adminPassword: brandEnv('ADMIN_PASSWORD'),
    version: VERSION,
    logger: createLogger((opts.log ?? brandEnv('LOG') ?? 'info') as LogLevel),
    webRoot: root && (await exists(join(root, 'index.html'))) ? root : undefined,
  })
  let info: Awaited<ReturnType<Daemon['listen']>>
  try {
    info = await daemon.listen()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      throw new UsageError(`Port ${port} is in use. Pick another with --port or ${brand.envPrefix}PORT.`)
    }
    throw error
  }
  const url = daemon.remote ? daemon.baseUrl : `http://127.0.0.1:${info.port}`
  if (process.stdout.isTTY || daemon.remote) {
    console.log(
      `\n  ${bold(brand.displayName)} ${dim(VERSION)}${daemon.remote ? ` ${yellow('hosted mode')}` : ''}\n`,
    )
    console.log(`  Web UI     ${cyan(url)}`)
    console.log(`  Clients    ${cyan(`${url}/c/<client>/mcp`)}`)
    console.log(`  Config     ${dim(daemon.paths.config)}`)
    if (daemon.remote) {
      console.log(`  Listening  ${dim(`${info.host}:${info.port}`)}`)
      console.log(
        dim(
          `\n  MCP clients need an API key (${brand.name} key create <client>); the web UI asks for the admin password.`,
        ),
      )
    }
    console.log()
  }
  if (opts.open && !daemon.remote) openBrowser(url)

  let stopping = false
  const stop = async () => {
    // A second Ctrl+C exits at once.
    if (stopping) process.exit(130)
    stopping = true
    if (process.stdout.isTTY) process.stdout.write(dim('\nStopping… (Ctrl+C again to force)\n'))
    // Never hang on shutdown: whatever is left after 5 seconds is abandoned.
    setTimeout(() => process.exit(1), 5000).unref()
    await daemon.close().catch(() => undefined)
    process.exit(0)
  }
  process.on('SIGINT', () => void stop())
  process.on('SIGTERM', () => void stop())
}

/** On the first interactive start, ask whether to keep an activity log. */
async function askAboutActivityLog() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return
  const store = await openConfig()
  if (store.config.settings.activityLog !== undefined) return
  console.log(
    `\n${bold('Keep an activity log?')} ${brand.displayName} can record which tools are called, how long they take and whether they succeed\n` +
      `(never arguments or results) in ${dim(paths().audit)}, to chart activity in the web UI.`,
  )
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question('Keep it? [Y/n] ')
  rl.close()
  const enabled = !/^n/i.test(answer.trim())
  await store.update((c) => ({ ...c, settings: { ...c.settings, activityLog: enabled } }))
  console.log(
    dim(`Activity log ${enabled ? 'on' : 'off'}. Change it any time with \`${brand.name} activity on|off\`.`),
  )
}

export async function startDetached(port: number, host?: string, publicUrl?: string) {
  const { logs } = paths()
  await mkdir(logs, { recursive: true })
  const log = await open(join(logs, 'daemon.log'), 'a')
  const args = [process.argv[1]!, 'up', '--no-open', '--port', String(port)]
  if (host) args.push('--host', host)
  if (publicUrl) args.push('--public-url', publicUrl)
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: ['ignore', log.fd, log.fd],
    env: process.env,
    windowsHide: true,
  })
  child.unref()
  await log.close()
}

export async function waitForDaemon(timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const daemon = await runningDaemon()
    if (daemon) return daemon
    await new Promise((r) => setTimeout(r, 150))
  }
  return undefined
}

export async function stop() {
  const daemon = await runningDaemon()
  if (!daemon) {
    console.log(`${brand.displayName} is not running.`)
    return
  }
  process.kill(daemon.pid, 'SIGTERM')
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline && (await runningDaemon())) await new Promise((r) => setTimeout(r, 100))
  console.log(`Stopped ${brand.displayName} (pid ${daemon.pid}).`)
}

interface Status {
  version: string
  pid: number
  port: number
  startedAt: string
  home: string
  secretsBackend: string
}

export async function status(opts: { json?: boolean }) {
  const daemon = await runningDaemon()
  if (!daemon) {
    if (opts.json) console.log(JSON.stringify({ running: false }))
    else console.log(`${brand.displayName} is ${yellow('not running')}. Start it with \`${brand.name} up\`.`)
    return
  }
  const [info, servers, sessions] = await Promise.all([
    api<Status>('/status'),
    api<
      {
        name: string
        status?: ConnectionStatus
        config: { enabled: boolean }
        instances?: { id: string; account: string | null; status?: ConnectionStatus }[]
      }[]
    >('/servers'),
    api<SessionInfo[]>('/sessions'),
  ])
  if (opts.json) {
    console.log(JSON.stringify({ running: true, ...info, servers, sessions }, null, 2))
    return
  }
  console.log(
    `${bold(brand.displayName)} ${info.version} ${green('running')} at ${cyan(daemon.url)} (pid ${info.pid})`,
  )
  console.log(dim(`home ${info.home} · secrets in ${info.secretsBackend}\n`))
  if (servers.length) {
    const state = (s?: ConnectionStatus) =>
      !s ? '' : s.state === 'ready' ? green('running') : s.state === 'error' ? red('error') : dim(s.state)
    console.log(
      table(
        // One row per running copy: the server itself, then each profile's own account.
        servers.flatMap((s) =>
          (s.instances?.length ? s.instances : [{ id: s.name, account: null, status: s.status }]).map((i) => [
            i.account ? `${s.name} ${dim(`(${i.account})`)}` : s.name,
            s.config.enabled ? state(i.status) : dim('disabled'),
            String(i.status?.toolCount ?? '-'),
            i.status?.lastError ? red(i.status.lastError.slice(0, 80)) : '',
          ]),
        ),
        ['SERVER', 'STATE', 'TOOLS', 'ERROR'],
      ),
    )
  } else {
    console.log(dim(`No servers yet. Add one with \`${brand.name} server add\` or \`${brand.name} import\`.`))
  }
  if (sessions.length) {
    console.log()
    console.log(
      table(
        sessions.map((s) => [
          s.client?.name ?? '?',
          s.profile ?? yellow('waiting'),
          s.via,
          s.surface ?? '-',
          s.lastSeenAt.slice(11, 19),
        ]),
        ['CLIENT', 'PROFILE', 'VIA', 'SURFACE', 'LAST SEEN'],
      ),
    )
  }
}

/** Find a command on PATH, like `which`. */
async function onPath(command: string): Promise<boolean> {
  if (command.includes('/') || command.includes('\\')) return exists(command)
  const exts = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : ['']
  for (const dir of (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':')) {
    for (const ext of exts) if (dir && (await exists(join(dir, command + ext)))) return true
  }
  return false
}

export async function doctor() {
  let problems = 0
  const ok = (text: string) => console.log(`${green('✓')} ${text}`)
  const warn = (text: string) => console.log(`${yellow('!')} ${text}`)
  const fail = (text: string) => {
    problems++
    console.log(`${red('✗')} ${text}`)
  }

  const major = Number(process.versions.node.split('.')[0])
  if (major >= 24) ok(`Node ${process.versions.node}`)
  else fail(`Node ${process.versions.node}: ${brand.displayName} needs Node 24 or later`)

  const p = paths()
  const home = await stat(p.home).catch(() => undefined)
  if (!home) warn(`${p.home} does not exist yet; \`${brand.name} up\` creates it`)
  else if (process.platform !== 'win32' && (home.mode & 0o077) !== 0) {
    warn(`${p.home} is readable by other users; run chmod 700 ${p.home}`)
  } else ok(`State directory ${p.home}`)

  let config: ReturnType<typeof parseConfig> | undefined
  try {
    const { readJson } = await import('@switchboard/core')
    config = parseConfig((await readJson(p.config)) ?? {})
    ok(
      `Config: ${Object.keys(config.servers).length} servers, ${Object.keys(config.profiles).length} profiles`,
    )
  } catch (error) {
    fail(`Config ${p.config}: ${(error as Error).message}`)
  }

  const daemon = await runningDaemon()
  if (daemon) ok(`Daemon running at ${daemon.url} (pid ${daemon.pid}, ${daemon.version})`)
  else warn(`Daemon not running; start it with \`${brand.name} up\``)

  const secrets = await openSecretBackend(p.secrets)
  ok(`Secrets stored in the ${secrets.kind}`)

  if (config) {
    const known = new Set(await secrets.list())
    for (const [name, server] of Object.entries(config.servers)) {
      if (!server.enabled) continue
      if (server.transport === 'stdio' && !(await onPath(server.command))) {
        fail(`Server ${name}: command "${server.command}" is not on PATH`)
      }
      const values =
        server.transport === 'stdio'
          ? [...server.args, ...Object.values(server.env)]
          : [server.url, ...Object.values(server.headers)]
      for (const ref of values.flatMap(secretRefs)) {
        if (!known.has(ref))
          fail(`Server ${name}: secret "${ref}" is not set; run \`${brand.name} secret set ${ref}\``)
      }
    }
    for (const [profile, p] of Object.entries(config.profiles)) {
      for (const [server, credential] of Object.entries(p.credentials)) {
        for (const ref of [...Object.values(credential.env), ...Object.values(credential.headers)].flatMap(
          secretRefs,
        )) {
          if (!known.has(ref))
            fail(
              `Profile ${profile}, ${server} credentials: secret "${ref}" is not set; run \`${brand.name} secret set ${ref}\``,
            )
        }
      }
    }
    if (!Object.keys(config.profiles).length)
      warn(`No profiles yet; create one with \`${brand.name} profile add\``)
    if (!config.defaultProfile && !config.clientRules.length) {
      warn('No default profile or client rules: clients must name a profile in their URL or header')
    }
  }

  for (const client of await listClients(defaultClientEnv())) {
    if (client.error) fail(`${client.name}: ${client.error}`)
    else if (client.connectedProfile) ok(`${client.name} connected to profile ${client.connectedProfile}`)
    else if (client.foreignEntry)
      warn(`${client.name}: has a "${brand.name}" entry ${brand.displayName} did not write`)
  }

  console.log(problems ? red(`\n${problems} problem${problems > 1 ? 's' : ''} found.`) : green('\nAll good.'))
  if (problems) process.exitCode = 1
}
