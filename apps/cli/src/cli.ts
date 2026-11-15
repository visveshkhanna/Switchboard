import { parseArgs } from 'node:util'
import { brand } from '@switchboard/shared'
import { runBridge } from './bridge.ts'
import * as cfg from './commands/config.ts'
import { doctor, startDetached, status, stop, up, waitForDaemon } from './commands/daemon.ts'
import { bold, defaultPort, dim, red, runningDaemon, UsageError, VERSION } from './util.ts'

const n = brand.name

const HELP = `${bold(brand.displayName)} ${dim(VERSION)}
One local MCP endpoint for all your AI agents.

${bold('Usage')}
  ${n} up [--port N] [--detach] [--no-open]   Start the daemon and open the web UI
  ${n} stop                                   Stop a detached daemon
  ${n} status [--json]                        Show servers and connected clients
  ${n} doctor                                 Check the setup and explain problems

  ${n} import [--client ID] [--yes]           Import servers from your AI clients
  ${n} server add NAME -- COMMAND [ARGS...]   Add a stdio server
  ${n} server add NAME --url URL [--sse]      Add a remote server
       [--env K=V] [--header K=V] [--cwd DIR] [--idle SECONDS]
  ${n} server ls | rm NAME | test NAME | enable NAME | disable NAME
  ${n} server auth NAME | signout NAME       Sign in to a server that uses OAuth
       [--profile NAME]                       ...the account a profile uses (or NAME.ACCOUNT)

  ${n} profile add NAME [--servers a,b] [--include s.tool] [--exclude s.tool]
       [--surface auto|passthrough|meta|code] [--description TEXT]
  ${n} profile ls | show NAME | rm NAME
  ${n} profile credentials NAME [SERVER]      A profile's own account of a server
       [--env K=V] [--header K=V] [--account NAME] [--remove]
  ${n} default PROFILE|none                   Profile for clients nothing else matches

  ${n} client ls                              Clients and the profile each one uses
  ${n} client connect ID                      Set a client up once (writes its config file)
  ${n} client use ID PROFILE|none|default     Switch a client's profile, live
  ${n} client connect ID --profile NAME       Advanced: pin a profile in the URL instead
  ${n} client disconnect ID
  ${n} rule add "CLIENT-GLOB" PROFILE         Pick a profile by MCP client name
  ${n} rule ls | rm "CLIENT-GLOB"

  ${n} secret set NAME [VALUE]                Store a secret (prompts if no value)
  ${n} secret ls | rm NAME

  ${n} connect [--client ID|--profile NAME]   stdio bridge for stdio-only clients

  ${n} activity [on|off]                      Keep a log of tool calls for activity charts

${bold('Hosting')}
  ${n} up --host 0.0.0.0 --public-url URL     Run reachable beyond this machine
  ${n} admin password                         Set the web UI password for hosted mode
  ${n} key create CLIENT [--label TEXT]       API key for a client (hosted mode)
  ${n} key ls | rm ID

${bold('Environment')}
  ${brand.envPrefix}HOME   state directory (default ~/${brand.stateDirName})
  ${brand.envPrefix}PORT   daemon port (default ${brand.defaultPort})
  ${brand.envPrefix}LOG    log level: debug, info, warn, error
  ${brand.envPrefix}HOST, ${brand.envPrefix}PUBLIC_URL, ${brand.envPrefix}ADMIN_PASSWORD   hosted mode

Docs: ${brand.docsUrl}`

const options = {
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
  port: { type: 'string', short: 'p' },
  host: { type: 'string' },
  detach: { type: 'boolean', short: 'd' },
  open: { type: 'boolean' },
  'no-open': { type: 'boolean' },
  json: { type: 'boolean' },
  yes: { type: 'boolean', short: 'y' },
  client: { type: 'string' },
  profile: { type: 'string' },
  url: { type: 'string' },
  sse: { type: 'boolean' },
  env: { type: 'string', multiple: true, short: 'e' },
  header: { type: 'string', multiple: true, short: 'H' },
  cwd: { type: 'string' },
  idle: { type: 'string' },
  servers: { type: 'string', multiple: true },
  include: { type: 'string', multiple: true },
  exclude: { type: 'string', multiple: true },
  surface: { type: 'string' },
  description: { type: 'string' },
  log: { type: 'string' },
  'public-url': { type: 'string' },
  label: { type: 'string' },
  auto: { type: 'boolean' },
  account: { type: 'string' },
  remove: { type: 'boolean' },
} as const

async function connect(profile: string | undefined, url: string | undefined, client?: string) {
  let target = url
  if (!target) {
    let daemon = await runningDaemon()
    if (!daemon) {
      process.stderr.write(`Starting ${brand.displayName}…\n`)
      await startDetached(defaultPort())
      daemon = await waitForDaemon(15_000)
      if (!daemon) throw new Error(`${brand.displayName} did not start; run \`${n} up\` to see why.`)
    }
    // Without a profile, the shared endpoint lets client rules and the default profile decide.
    target = client
      ? `${daemon.url}/c/${client}/mcp`
      : profile
        ? `${daemon.url}/p/${profile}/mcp`
        : `${daemon.url}/mcp`
  }
  await runBridge(target)
}

async function main(argv: string[]) {
  const dashDash = argv.indexOf('--')
  const command = dashDash >= 0 ? argv.slice(dashDash + 1) : []
  const { values: o, positionals } = parseArgs({
    args: dashDash >= 0 ? argv.slice(0, dashDash) : argv,
    options,
    allowPositionals: true,
    strict: true,
  })
  const [cmd, sub, a1, a2] = positionals

  if (o.version) return console.log(VERSION)
  if (o.help || !cmd || cmd === 'help') return console.log(HELP)

  switch (cmd) {
    case 'up':
      return up({
        port: o.port,
        host: o.host,
        publicUrl: o['public-url'],
        detach: o.detach,
        open: !o['no-open'] && o.open !== false,
        log: o.log,
      })
    case 'stop':
      return stop()
    case 'status':
      return status({ json: o.json })
    case 'doctor':
      return doctor()
    case 'import':
      return cfg.importServers({ client: o.client, yes: o.yes })
    case 'connect':
      return connect(o.profile ?? sub, o.url, o.client)
    case 'default':
      return cfg.setDefault(sub)
    case 'activity':
      return cfg.activity(sub)
    case 'admin':
      if (sub === 'password') return cfg.adminPasswordSet()
      break
    case 'key':
    case 'keys':
      switch (sub) {
        case 'create':
        case 'add':
          return cfg.keyCreate(a1, { label: o.label })
        case 'ls':
        case 'list':
        case undefined:
          return cfg.keyList()
        case 'rm':
        case 'revoke':
          return cfg.keyRemove(a1)
      }
      break
    case 'server':
      switch (sub) {
        case 'add':
          return cfg.serverAdd(a1, command, o)
        case 'ls':
        case 'list':
          return cfg.serverList()
        case 'rm':
        case 'remove':
          return cfg.serverRemove(a1)
        case 'test':
          return cfg.serverTest(a1, o)
        case 'auth':
        case 'login':
          return cfg.serverAuth(a1, o)
        case 'signout':
        case 'logout':
          return cfg.serverSignOut(a1, o)
        case 'enable':
          return cfg.serverEnable(a1, true)
        case 'disable':
          return cfg.serverEnable(a1, false)
      }
      break
    case 'profile':
      switch (sub) {
        case 'add':
        case 'set':
          return cfg.profileAdd(a1, o)
        case 'ls':
        case 'list':
          return cfg.profileList()
        case 'show':
          return cfg.profileShow(a1)
        case 'rm':
        case 'remove':
          return cfg.profileRemove(a1)
        case 'credentials':
        case 'creds':
          return cfg.profileCredentials(a1, a2, o)
      }
      break
    case 'client':
      switch (sub) {
        case 'ls':
        case 'list':
          return cfg.clientList()
        case 'connect':
          return cfg.clientConnect(a1, { profile: o.profile, port: o.port, auto: o.auto })
        case 'use':
          return cfg.clientUse(a1, a2)
        case 'disconnect':
          return cfg.clientDisconnect(a1)
      }
      break
    case 'rule':
      switch (sub) {
        case 'add':
          return cfg.ruleAdd(a1, a2)
        case 'ls':
        case 'list':
          return cfg.ruleList()
        case 'rm':
        case 'remove':
          return cfg.ruleRemove(a1)
      }
      break
    case 'secret':
      switch (sub) {
        case 'set':
          return cfg.secretSet(a1, a2)
        case 'ls':
        case 'list':
          return cfg.secretList()
        case 'rm':
        case 'remove':
          return cfg.secretRemove(a1)
      }
      break
  }
  throw new UsageError(`Unknown command "${positionals.join(' ')}". Run \`${n} --help\`.`)
}

main(process.argv.slice(2)).catch((error: unknown) => {
  if (error instanceof UsageError || (error as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')) {
    console.error(red((error as Error).message))
    process.exit(2)
  }
  console.error(red(error instanceof Error ? error.message : String(error)))
  if (process.env[`${brand.envPrefix}DEBUG`] && error instanceof Error) console.error(error.stack)
  process.exit(1)
})
