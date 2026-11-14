import { brand } from '@switchboard/shared'

/** Everything the copy-paste snippets and the AI prompt need to know about the daemon. */
export function baseUrl(port?: number): string {
  return `http://${brand.defaultHost}:${port ?? brand.defaultPort}`
}

export function profileUrl(port: number | undefined, profile: string): string {
  return `${baseUrl(port)}/p/${profile}/mcp`
}

export function sharedUrl(port?: number): string {
  return `${baseUrl(port)}/mcp`
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
export function entryFor(clientId: string, url: string, profile: string | null): Record<string, unknown> {
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
        args: ['-y', brand.packageName, 'connect', ...(profile ? ['--profile', profile] : [])],
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

/** The exact block to paste into a client's config file, `profile: null` meaning the shared /mcp URL. */
export function configSnippet(clientId: string, port: number | undefined, profile: string | null): string {
  const info = clientInfo(clientId)
  const url = profile ? profileUrl(port, profile) : sharedUrl(port)
  const entry = entryFor(clientId, url, profile)
  if (info?.format === 'toml') return `[${info.key}.${brand.name}]\n${toml(entry)}`
  return JSON.stringify({ [info?.key ?? 'mcpServers']: { [brand.name]: entry } }, null, 2)
}

/** The "add this MCP to your client" text, for one client. */
export function manualInstructions(
  clientId: string,
  port: number | undefined,
  profile: string | null,
): string {
  const info = clientInfo(clientId)
  const name = info?.name ?? clientId
  const url = profile ? profileUrl(port, profile) : sharedUrl(port)
  const lines = [
    `Add ${brand.displayName} to ${name}`,
    '',
    `File: ${info?.file ?? 'the client MCP config file'}`,
    `Merge this into it${info?.format === 'json' ? ` (keep any other entries under "${info.key}")` : ''}:`,
    '',
    configSnippet(clientId, port, profile),
  ]
  if (info?.cli) lines.push('', 'Or run:', '', info.cli(url))
  if (info?.bridge)
    lines.push(
      '',
      `${name} only runs local commands, so this starts a small stdio bridge to the daemon at ${baseUrl(port)}.`,
    )
  lines.push('', `Restart ${name} afterwards.`)
  return lines.join('\n')
}

/** A self-contained prompt for an AI coding agent that sets Switchboard up for the user. */
export function agentPrompt({
  clientId,
  port,
  profiles,
  servers,
  defaultProfile,
}: {
  clientId: string
  port?: number
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
            `- ${p.name}${p.name === defaultProfile ? ' (default)' : ''}: ${profileUrl(port, p.name)} (servers: ${p.servers.join(', ') || 'none'})`,
        )
        .join('\n')
    : '- (none yet)'
  return `You are helping me set up ${brand.displayName}, a local MCP gateway, for ${client}.

## What ${brand.displayName} is
${brand.displayName} is a daemon running on my machine at ${baseUrl(port)}. It runs my MCP servers once and serves them to every AI client through "profiles": named groups of servers and tools, each at its own Streamable HTTP endpoint:
  ${baseUrl(port)}/p/<profile>/mcp
There is also a shared endpoint, ${sharedUrl(port)}, where the profile is picked by client rules (a glob on the MCP client name) or the default profile. A client that matches neither still connects but waits, with no tools, until a profile is assigned to it (in the dashboard's Clients page or with a rule).
Docs: ${brand.docsUrl}/docs

## Current state
Servers: ${servers.length ? servers.join(', ') : '(none yet)'}
Profiles:
${profileLines}

## Commands you may use (the CLI is "${cli}"; "${brand.name}" works too if it is installed globally)
- ${cli} status                                  # daemon, servers, profiles, connected clients
- ${brand.name} import --yes                         # import MCP servers from installed clients
- ${brand.name} profile add NAME --servers a,b       # create a profile from servers
- ${brand.name} client connect ${clientId} --profile NAME   # write the ${brand.name} entry into ${client}'s config
- ${brand.name} rule add "<glob>" NAME              # route clients on the shared /mcp URL by name
- ${brand.name} doctor                               # diagnose problems

## Goals, step by step
1. Run \`${cli} status\` to see what is running. If the daemon is not running, start it with \`${cli} up\`.
2. Inspect my existing MCP servers: the ones already in ${brand.displayName}, and the ones configured in my AI clients (${info?.file ?? 'their config files'} and others). Use \`${brand.name} import --yes\` only after I agree.
3. Propose profiles that fit how I work (for example "personal" and "work"), listing which servers go in each and why. ASK ME before creating, changing or deleting anything.
4. Once I approve, create the profiles with \`${brand.name} profile add\`.
5. Connect ${client}: \`${brand.name} client connect ${clientId} --profile NAME\`. This writes one entry named "${brand.name}" into ${info?.file ?? `${client}'s MCP config`} and keeps a backup. Tell me to restart ${client} afterwards.
6. Verify with \`${brand.name} status\` (and \`${brand.name} doctor\` if anything looks wrong), then summarise what changed.

Rules: never print or move secrets or tokens; never edit other entries in my client configs; ask before any change.`
}
