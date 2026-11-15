import { brand } from '@switchboard/shared'

/** Everything the copy-paste snippets and the AI prompt need to know about the daemon. */
/** Where clients reach the daemon: the public URL when hosted, else the loopback address. */
export function baseUrl(status?: { baseUrl?: string; port?: number }): string {
  return (
    status?.baseUrl?.replace(/\/+$/, '') ?? `http://${brand.defaultHost}:${status?.port ?? brand.defaultPort}`
  )
}

export function profileUrl(base: string, profile: string): string {
  return `${base}/p/${profile}/mcp`
}

export function sharedUrl(base: string): string {
  return `${base}/mcp`
}

/** A client's own URL: its profile is then switched in Switchboard, not in its config file. */
export function clientUrl(base: string, id: string): string {
  return `${base}/c/${id}/mcp`
}

export interface ClientInfo {
  id: string
  name: string
  /** Where the entry goes, as people write it. */
  file: string
  /** The key inside the file that holds servers. */
  key: string
  format: 'json' | 'toml'
  /** True when the client only runs local commands (stdio bridge). */
  bridge?: boolean
  /** A one-line CLI alternative, when the client has one. */
  cli?: (url: string) => string
}

export const CLIENT_INFO: ClientInfo[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    file: '~/.claude.json',
    key: 'mcpServers',
    format: 'json',
    cli: (url) => `claude mcp add --transport http ${brand.name} ${url}`,
  },
  { id: 'cursor', name: 'Cursor', file: '~/.cursor/mcp.json', key: 'mcpServers', format: 'json' },
  {
    id: 'vscode',
    name: 'VS Code',
    file: 'mcp.json in your VS Code user folder (or .vscode/mcp.json in a project)',
    key: 'servers',
    format: 'json',
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    file: '~/.codeium/windsurf/mcp_config.json',
    key: 'mcpServers',
    format: 'json',
  },
  { id: 'codex', name: 'Codex', file: '~/.codex/config.toml', key: 'mcp_servers', format: 'toml' },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    file: '~/.gemini/settings.json',
    key: 'mcpServers',
    format: 'json',
  },
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    file: 'claude_desktop_config.json (Settings → Developer → Edit Config)',
    key: 'mcpServers',
    format: 'json',
    bridge: true,
  },
]

export function clientInfo(id: string): ClientInfo | undefined {
  return CLIENT_INFO.find((c) => c.id === id)
}

/** The value Switchboard writes under its `switchboard` key for a client. */
export function entryFor(
  clientId: string,
  url: string,
  target: { profile?: string | null; client?: string } = {},
): Record<string, unknown> {
  switch (clientId) {
    case 'claude-code':
    case 'vscode':
      return { type: 'http', url }
    case 'windsurf':
      return { serverUrl: url }
    case 'gemini-cli':
      return { httpUrl: url }
    case 'claude-desktop':
      return {
        command: 'npx',
        args: [
          '-y',
          brand.packageName,
          'connect',
          ...(target.client
            ? ['--client', target.client]
            : target.profile
              ? ['--profile', target.profile]
              : []),
        ],
      }
    default:
      return { url }
  }
}

function toml(value: Record<string, unknown>): string {
  return Object.entries(value)
    .map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
    .join('\n')
}

function wrap(clientId: string, entry: Record<string, unknown>): string {
  const info = clientInfo(clientId)
  if (info?.format === 'toml') return `[${info.key}.${brand.name}]\n${toml(entry)}`
  return JSON.stringify({ [info?.key ?? 'mcpServers']: { [brand.name]: entry } }, null, 2)
}

/** The block Switchboard writes when it sets a client up with its own URL. */
export function clientSnippet(clientId: string, url: string): string {
  return wrap(clientId, entryFor(clientId, url, { client: clientId }))
}

/** The "add this MCP to your client" text, for one client, using its own URL. */
export function manualInstructions(clientId: string, base: string): string {
  const info = clientInfo(clientId)
  const name = info?.name ?? clientId
  const url = clientUrl(base, clientId)
  const lines = [
    `Add ${brand.displayName} to ${name}`,
    '',
    `File: ${info?.file ?? 'the client MCP config file'}`,
    `Merge this into it${info?.format === 'json' ? ` (keep any other entries under "${info.key}")` : ''}:`,
    '',
    clientSnippet(clientId, url),
  ]
  if (info?.cli) lines.push('', 'Or run:', '', info.cli(url))
  if (info?.bridge)
    lines.push(
      '',
      `${name} only runs local commands, so this starts a small stdio bridge to the daemon at ${base}.`,
    )
  lines.push(
    '',
    `Restart ${name} once. After that, pick its profile in the ${brand.displayName} dashboard (Clients); it switches live.`,
  )
  return lines.join('\n')
}

/** A self-contained prompt for an AI coding agent that sets Switchboard up for the user. */
export function agentPrompt({
  clientId,
  base,
  remote,
  profiles,
  servers,
  defaultProfile,
}: {
  clientId: string
  base: string
  remote?: boolean
  profiles: { name: string; servers: string[] }[]
  servers: string[]
  defaultProfile?: string
}): string {
  const info = clientInfo(clientId)
  const client = info?.name ?? clientId
  const cli = `npx ${brand.packageName}`
  const profileLines = profiles.length
    ? profiles
        .map(
          (p) =>
            `- ${p.name}${p.name === defaultProfile ? ' (default)' : ''}: ${profileUrl(base, p.name)} (servers: ${p.servers.join(', ') || 'none'})`,
        )
        .join('\n')
    : '- (none yet)'
  return `You are helping me set up ${brand.displayName}, a local MCP gateway, for ${client}.

## What ${brand.displayName} is
${brand.displayName} is a daemon running at ${base}. It runs my MCP servers once and serves them to every AI client through "profiles": named groups of servers and tools, each at its own Streamable HTTP endpoint:
  ${base}/p/<profile>/mcp
There is also a shared endpoint, ${sharedUrl(base)}, where the profile is picked by the client's MCP name (client rules) or the default profile. A client that matches nothing still connects but waits, with no tools, until a profile is chosen for it.
Docs: ${brand.docsUrl}/docs
${remote ? `\nThis ${brand.displayName} is hosted, not on this machine: every MCP client must send an API key as the header "Authorization: Bearer sbk_…". The user creates one per client in the dashboard (Clients → Create API key); never invent or print keys yourself. The CLI commands below run where the daemon runs.\n` : ''}
## Current state
Servers: ${servers.length ? servers.join(', ') : '(none yet)'}
Profiles:
${profileLines}
Each client is set up once with its own URL, ${clientUrl(base, '<client-id>')}. Its profile is then a setting in ${brand.displayName}: switching it moves connected sessions live, with no config edit and no restart. Exactly one profile per client; a client with none switched on follows the default profile.

## Commands you may use (the CLI is "${cli}"; "${brand.name}" works too if it is installed globally)
- ${cli} status                                  # daemon, servers, profiles, connected clients
- ${brand.name} import --yes                         # import MCP servers from installed clients
- ${brand.name} profile add NAME --servers a,b       # create a profile from servers
- ${brand.name} client ls                            # clients and the profile each one uses
- ${brand.name} client connect ${clientId}                # set ${client} up once (writes its config file)
- ${brand.name} client use ${clientId} NAME               # switch ${client}'s profile, live (NAME, none or default)
- ${brand.name} default NAME                         # profile for clients nothing else matches
- ${brand.name} doctor                               # diagnose problems

## Goals, step by step
1. Run \`${cli} status\` to see what is running. If the daemon is not running, start it with \`${cli} up\`.
2. Inspect my existing MCP servers: the ones already in ${brand.displayName}, and the ones configured in my AI clients (${info?.file ?? 'their config files'} and others). Use \`${brand.name} import --yes\` only after I agree.
3. Propose profiles that fit how I work (for example "personal" and "work"), listing which servers go in each and why. ASK ME before creating, changing or deleting anything.
4. Once I approve, create the profiles with \`${brand.name} profile add\`.
5. Set ${client} up once: \`${brand.name} client connect ${clientId}\`. This writes one entry named "${brand.name}" (its own URL) into ${info?.file ?? `${client}'s MCP config`} and keeps a backup. Tell me to restart ${client} once.
6. Choose its profile: \`${brand.name} client use ${clientId} NAME\`. Later switches apply live; no restart.
7. Verify with \`${brand.name} status\` (and \`${brand.name} doctor\` if anything looks wrong), then summarise what changed.

Rules: never print or move secrets or tokens; never edit other entries in my client configs; ask before any change.`
}
