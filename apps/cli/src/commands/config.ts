import { createInterface } from 'node:readline/promises'
import {
  Catalog,
  CLIENTS,
  connectClient,
  defaultClientEnv,
  disconnectClient,
  exposedToolName,
  importCandidates,
  listClients,
  openSecretBackend,
  silentLogger,
  UpstreamConnection,
} from '@switchboard/core'
import {
  brand,
  matchToolPattern,
  profileSchema,
  type ServerConfigInput,
  serverConfigSchema,
  slugSchema,
  surfaceSchema,
} from '@switchboard/shared'
import {
  api,
  bold,
  cyan,
  defaultPort,
  dim,
  green,
  keyValues,
  list,
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

function slug(value: string | undefined, what: string): string {
  if (!value) throw new UsageError(`Missing ${what} name.`)
  const result = slugSchema.safeParse(value)
  if (!result.success)
    throw new UsageError(`Invalid ${what} name "${value}": ${result.error.issues[0]?.message}`)
  return value
}

// ── servers ────────────────────────────────────────────────────────────────

export async function serverAdd(
  name: string | undefined,
  command: string[],
  opts: { url?: string; sse?: boolean; env?: string[]; header?: string[]; idle?: string; cwd?: string },
) {
  const server = slug(name, 'server')
  let input: ServerConfigInput
  if (opts.url) {
    input = {
      transport: opts.sse ? 'sse' : 'http',
      url: opts.url,
      headers: keyValues(opts.header, '--header'),
    }
  } else if (command.length) {
    input = {
      transport: 'stdio',
      command: command[0]!,
      args: command.slice(1),
      env: keyValues(opts.env, '--env'),
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
    }
  } else {
    throw new UsageError(
      `Give a command after --, or --url.\n  ${brand.name} server add github -- npx -y @modelcontextprotocol/server-github\n  ${brand.name} server add linear --url https://mcp.linear.app/mcp`,
    )
  }
  if (opts.idle) input.idleTimeoutSec = Number(opts.idle)
  const parsed = serverConfigSchema.parse(input)
  const store = await openConfig()
  const existed = !!store.config.servers[server]
  await store.update((c) => {
    c.servers[server] = parsed
    return c
  })
  console.log(`${existed ? 'Updated' : 'Added'} server ${bold(server)}.`)
  if (!existed) console.log(dim(`Add it to a profile: ${brand.name} profile add <name> --servers ${server}`))
}

export async function serverList() {
  const store = await openConfig()
  const catalog = await Catalog.open(paths().catalog)
  const rows = Object.entries(store.config.servers).map(([name, s]) => [
    name,
    s.transport,
    s.transport === 'stdio' ? [s.command, ...s.args].join(' ') : s.url,
    String(catalog.get(name)?.tools.length ?? '-'),
    s.enabled ? '' : dim('disabled'),
  ])
  if (!rows.length)
    return console.log(`No servers. Add one with \`${brand.name} server add\` or \`${brand.name} import\`.`)
  console.log(table(rows, ['NAME', 'TRANSPORT', 'TARGET', 'TOOLS', '']))
}

export async function serverRemove(name: string | undefined) {
  const server = slug(name, 'server')
  const store = await openConfig()
  if (!store.config.servers[server]) throw new UsageError(`No server named "${server}".`)
  await store.update((c) => {
    delete c.servers[server]
    for (const p of Object.values(c.profiles)) p.servers = p.servers.filter((s) => s !== server)
    return c
  })
  console.log(`Removed server ${bold(server)}.`)
}

export async function serverEnable(name: string | undefined, enabled: boolean) {
  const server = slug(name, 'server')
  const store = await openConfig()
  if (!store.config.servers[server]) throw new UsageError(`No server named "${server}".`)
  await store.update((c) => {
    c.servers[server]!.enabled = enabled
    return c
  })
  console.log(`${enabled ? 'Enabled' : 'Disabled'} server ${bold(server)}.`)
}

/** Start the server here, list its tools, stop it. */
export async function serverTest(name: string | undefined) {
  const server = slug(name, 'server')
  const store = await openConfig()
  const config = store.config.servers[server]
  if (!config) throw new UsageError(`No server named "${server}".`)
  const catalog = await Catalog.open(paths().catalog)
  const connection = new UpstreamConnection(
    server,
    { ...config, enabled: true },
    {
      catalog,
      secrets: await openSecretBackend(paths().secrets),
      log: silentLogger,
      version: VERSION,
    },
  )
  process.stdout.write(`Starting ${server}… `)
  try {
    const tools = await connection.sync()
    console.log(green('ok'))
    for (const tool of tools)
      console.log(`  ${bold(tool.name)} ${dim((tool.description ?? '').split('\n')[0]!.slice(0, 90))}`)
    console.log(dim(`\n${tools.length} tools`))
    await catalog.flush()
  } catch (error) {
    console.log(red('failed'))
    console.log((error as Error).message)
    if (connection.stderr.length) console.log(dim(connection.stderr.slice(-15).join('\n')))
    process.exitCode = 1
  } finally {
    await connection.stop()
  }
}

/** Sign in to a server that uses OAuth: the daemon handles the browser callback. */
export async function serverAuth(name: string | undefined) {
  const server = slug(name, 'server')
  const result = await api<{ ok: boolean; authUrl?: string; signedIn?: boolean; error?: string }>(
    `/servers/${server}/auth`,
    { method: 'POST' },
  )
  if (result.signedIn) return console.log(`${bold(server)} is already signed in.`)
  if (!result.authUrl) throw new Error(result.error ?? 'The server did not ask for sign-in.')
  console.log(`Opening the sign-in page for ${bold(server)}:\n${cyan(result.authUrl)}`)
  openBrowser(result.authUrl)
  for (let i = 0; i < 300; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    const servers = await api<{ name: string; status?: { state: string } }[]>('/servers')
    if (servers.find((s) => s.name === server)?.status?.state === 'ready') {
      return console.log(green(`Signed in to ${server}.`))
    }
  }
  throw new Error('Timed out waiting for sign-in.')
}

export async function serverSignOut(name: string | undefined) {
  const server = slug(name, 'server')
  await api(`/servers/${server}/signout`, { method: 'POST' })
  console.log(`Signed out of ${bold(server)}.`)
}

// ── profiles ───────────────────────────────────────────────────────────────

export async function profileAdd(
  name: string | undefined,
  opts: {
    servers?: string[]
    include?: string[]
    exclude?: string[]
    surface?: string
    description?: string
  },
) {
  const profile = slug(name, 'profile')
  const store = await openConfig()
  const current = store.config.profiles[profile]
  const surface = opts.surface ? surfaceSchema.parse(opts.surface) : undefined
  const next = profileSchema.parse({
    ...current,
    ...(opts.description !== undefined ? { description: opts.description } : {}),
    ...(opts.servers ? { servers: list(opts.servers) } : {}),
    ...(opts.include ? { include: list(opts.include) } : {}),
    ...(opts.exclude ? { exclude: list(opts.exclude) } : {}),
    ...(surface ? { surface } : {}),
  })
  await store.update((c) => {
    c.profiles[profile] = next
    return c
  })
  console.log(`${current ? 'Updated' : 'Added'} profile ${bold(profile)}.`)
  console.log(`Endpoint: ${cyan(`http://127.0.0.1:${defaultPort()}/p/${profile}/mcp`)}`)
  if (!current) console.log(dim(`Connect a client: ${brand.name} client connect cursor --profile ${profile}`))
}

export async function profileList() {
  const store = await openConfig()
  const { profiles, defaultProfile } = store.config
  const rows = Object.entries(profiles).map(([name, p]) => [
    name + (name === defaultProfile ? dim(' (default)') : ''),
    p.surface,
    p.servers.join(', ') || dim('-'),
    [...p.include.map((x) => `+${x}`), ...p.exclude.map((x) => `-${x}`)].join(' '),
  ])
  if (!rows.length)
    return console.log(`No profiles. Add one with \`${brand.name} profile add <name> --servers a,b\`.`)
  console.log(table(rows, ['PROFILE', 'SURFACE', 'SERVERS', 'TOOLS']))
}

export async function profileShow(name: string | undefined) {
  const profile = slug(name, 'profile')
  const store = await openConfig()
  const p = store.config.profiles[profile]
  if (!p) throw new UsageError(`No profile named "${profile}".`)
  const catalog = await Catalog.open(paths().catalog)
  console.log(`${bold(profile)}${p.description ? ` ${dim(p.description)}` : ''}`)
  console.log(
    `Surface ${p.surface} · endpoint ${cyan(`http://127.0.0.1:${defaultPort()}/p/${profile}/mcp`)}\n`,
  )
  for (const [server, config] of Object.entries(store.config.servers)) {
    const tools = catalog.get(server)?.tools ?? []
    const included = tools.filter(
      (t) =>
        (p.servers.includes(server) || p.include.some((x) => matchToolPattern(x, server, t.name))) &&
        !p.exclude.some((x) => matchToolPattern(x, server, t.name)),
    )
    if (!included.length && !p.servers.includes(server)) continue
    console.log(`${bold(server)}${config.enabled ? '' : dim(' (disabled)')}`)
    if (!tools.length) console.log(dim(`  tools not known yet; run \`${brand.name} server test ${server}\``))
    for (const t of included) console.log(`  ${exposedToolName(server, t.name)}`)
  }
}

export async function profileRemove(name: string | undefined) {
  const profile = slug(name, 'profile')
  const store = await openConfig()
  if (!store.config.profiles[profile]) throw new UsageError(`No profile named "${profile}".`)
  await store.update((c) => {
    delete c.profiles[profile]
    c.clientRules = c.clientRules.filter((r) => r.profile !== profile)
    if (c.defaultProfile === profile) c.defaultProfile = undefined
    return c
  })
  console.log(`Removed profile ${bold(profile)}.`)
}

export async function setDefault(name: string | undefined) {
  if (!name) throw new UsageError(`Give a profile, or "none".`)
  const store = await openConfig()
  const profile = name === 'none' ? undefined : slug(name, 'profile')
  await store.update((c) => ({ ...c, defaultProfile: profile }))
  console.log(profile ? `Default profile is now ${bold(profile)}.` : 'No default profile.')
}

// ── client rules ───────────────────────────────────────────────────────────

export async function ruleAdd(client: string | undefined, profile: string | undefined) {
  if (!client) throw new UsageError('Give a client name pattern, e.g. "cursor*".')
  const target = slug(profile, 'profile')
  const store = await openConfig()
  await store.update((c) => {
    c.clientRules = [...c.clientRules.filter((r) => r.client !== client), { client, profile: target }]
    return c
  })
  console.log(`Clients matching ${bold(client)} now use profile ${bold(target)}.`)
}

export async function ruleList() {
  const store = await openConfig()
  const rules = store.config.clientRules
  if (!rules.length)
    return console.log(`No client rules. Add one with \`${brand.name} rule add "cursor*" work\`.`)
  console.log(
    table(
      rules.map((r, i) => [String(i + 1), r.client, r.profile]),
      ['#', 'CLIENT', 'PROFILE'],
    ),
  )
}

export async function ruleRemove(client: string | undefined) {
  if (!client) throw new UsageError('Give the client pattern to remove.')
  const store = await openConfig()
  await store.update((c) => ({ ...c, clientRules: c.clientRules.filter((r) => r.client !== client) }))
  console.log(`Removed rule ${bold(client)}.`)
}

// ── activity log ───────────────────────────────────────────────────────────

export async function activity(value: string | undefined) {
  const store = await openConfig()
  if (value === 'on' || value === 'off') {
    await store.update((c) => ({ ...c, settings: { ...c.settings, activityLog: value === 'on' } }))
  } else if (value !== undefined) {
    throw new UsageError('Use `activity on`, `activity off` or `activity` to see the setting.')
  }
  const { activityLog, retentionDays } = store.config.settings
  console.log(
    activityLog === undefined
      ? `Activity log not set up yet: run \`${brand.name} activity on\` or \`off\`.`
      : `Activity log ${activityLog ? green('on') : 'off'}${activityLog ? ` (kept ${retentionDays} days in ${paths().audit})` : ''}.`,
  )
}

// ── secrets ────────────────────────────────────────────────────────────────

async function readSecretValue(name: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
    return Buffer.concat(chunks)
      .toString('utf8')
      .replace(/\r?\n$/, '')
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
  // Hide what is typed.
  const out = rl as unknown as { _writeToOutput?: (s: string) => void }
  process.stdout.write(`Value for ${name}: `)
  out._writeToOutput = () => undefined
  const value = await rl.question('')
  rl.close()
  process.stdout.write('\n')
  return value
}

export async function secretSet(name: string | undefined, value: string | undefined) {
  if (!name || !/^[A-Za-z0-9_.-]+$/.test(name))
    throw new UsageError('Give a secret name using letters, digits, ".", "-" and "_".')
  const secret = value ?? (await readSecretValue(name))
  if (!secret) throw new UsageError('The secret is empty.')
  const backend = await openSecretBackend(paths().secrets)
  await backend.set(name, secret)
  console.log(
    `Saved ${bold(name)} in the ${backend.kind}. Use it as ${cyan(`secret://${name}`)} in env, args or headers.`,
  )
}

export async function secretList() {
  const backend = await openSecretBackend(paths().secrets)
  const names = await backend.list()
  if (!names.length) return console.log(`No secrets. Add one with \`${brand.name} secret set <name>\`.`)
  console.log(names.join('\n'))
  console.log(dim(`\nStored in the ${backend.kind}.`))
}

export async function secretRemove(name: string | undefined) {
  if (!name) throw new UsageError('Give the secret name.')
  const backend = await openSecretBackend(paths().secrets)
  await backend.delete(name)
  console.log(`Removed ${bold(name)}.`)
}

// ── import ─────────────────────────────────────────────────────────────────

export async function importServers(opts: { client?: string; yes?: boolean }) {
  const store = await openConfig()
  const candidates = (await importCandidates(defaultClientEnv())).filter(
    (c) => !opts.client || c.client === opts.client,
  )
  const fresh = candidates.filter(
    (c, i) => !store.config.servers[c.name] && candidates.findIndex((x) => x.name === c.name) === i,
  )
  if (!candidates.length) return console.log('No MCP servers found in your clients’ configuration files.')
  console.log(
    table(
      candidates.map((c) => [
        c.name,
        c.client,
        c.server.transport,
        store.config.servers[c.name]
          ? dim('already added')
          : fresh.includes(c)
            ? green('new')
            : dim('duplicate'),
      ]),
      ['SERVER', 'FROM', 'TRANSPORT', ''],
    ),
  )
  if (!fresh.length) return
  if (!opts.yes) {
    if (!process.stdin.isTTY) return console.log(dim('\nRun again with --yes to import the new servers.'))
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const answer = await rl.question(`\nImport ${fresh.length} server${fresh.length > 1 ? 's' : ''}? [Y/n] `)
    rl.close()
    if (/^n/i.test(answer.trim())) return
  }
  await store.update((c) => {
    for (const item of fresh) c.servers[item.name] = serverConfigSchema.parse(item.server)
    return c
  })
  console.log(`Imported ${fresh.map((f) => bold(f.name)).join(', ')}.`)
  const secretish = fresh.filter(
    (f) =>
      Object.keys(f.server.transport === 'stdio' ? (f.server.env ?? {}) : (f.server.headers ?? {})).length,
  )
  if (secretish.length) {
    console.log(
      yellow(
        `\n${secretish.map((f) => f.name).join(', ')} ${secretish.length > 1 ? 'have' : 'has'} env or headers copied as plain text into config.json. ` +
          `Move tokens into secrets with \`${brand.name} secret set <name>\` and reference them as secret://<name>.`,
      ),
    )
  }
}

// ── AI clients ─────────────────────────────────────────────────────────────

export async function clientList() {
  const store = await openConfig()
  const states = await listClients(defaultClientEnv())
  console.log(
    table(
      states.map((c) => [
        c.id,
        c.name,
        c.installed ? '' : dim('not found'),
        c.error
          ? red(c.error)
          : c.connectedMode === 'auto'
            ? green('→ automatic')
            : c.connectedProfile
              ? green(`→ ${c.connectedProfile}`)
              : c.foreignEntry
                ? yellow('foreign entry')
                : '',
        String(c.serverCount || ''),
      ]),
      ['ID', 'CLIENT', 'INSTALLED', 'SWITCHBOARD', 'OTHER SERVERS'],
    ),
  )
  if (!Object.keys(store.config.profiles).length)
    console.log(dim(`\nCreate a profile first: ${brand.name} profile add <name>`))
}

export async function clientConnect(
  id: string | undefined,
  opts: { profile?: string; port?: string; auto?: boolean },
) {
  if (!id) throw new UsageError(`Give a client: ${CLIENTS.map((c) => c.id).join(', ')}.`)
  if (!opts.auto && !opts.profile)
    throw new UsageError('Give --profile NAME, or --auto to let client rules decide.')
  const profile = opts.auto ? null : slug(opts.profile, 'profile')
  const store = await openConfig()
  if (profile && !store.config.profiles[profile]) throw new UsageError(`No profile named "${profile}".`)
  const daemon = await runningDaemon()
  const port = opts.port ? Number(opts.port) : (daemon?.port ?? defaultPort())
  const { path, backup } = await connectClient(
    id,
    { url: `http://127.0.0.1:${port}${profile ? `/p/${profile}` : ''}/mcp`, profile },
    defaultClientEnv(),
    paths().backups,
  )
  console.log(
    profile
      ? `Connected ${bold(id)} to profile ${bold(profile)} in ${path}.`
      : `Connected ${bold(id)} to the shared endpoint in ${path}; client rules and the default profile pick its profile.`,
  )
  if (backup) console.log(dim(`Backup: ${backup}`))
  console.log(dim('Restart or reload the client to pick it up.'))
}

export async function clientDisconnect(id: string | undefined) {
  if (!id) throw new UsageError('Give a client id.')
  const { path } = await disconnectClient(id, defaultClientEnv(), paths().backups)
  console.log(`Removed ${brand.displayName} from ${bold(id)} (${path}).`)
}
