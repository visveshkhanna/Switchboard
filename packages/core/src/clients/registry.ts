import { homedir } from 'node:os'
import { join } from 'node:path'
import { brand } from '@switchboard/shared'

/**
 * Where each AI client keeps its MCP servers and how an entry looks. Adding a
 * client is adding an entry here, plus a test with a sample file.
 */

export interface ClientEnv {
  home: string
  platform: NodeJS.Platform
  /** APPDATA on Windows. */
  appData?: string
}

export interface ConnectTarget {
  /** Streamable HTTP endpoint for the profile, e.g. http://127.0.0.1:7690/p/work/mcp */
  url: string
  /** A profile pinned in the URL (/p/<profile>/mcp), or null. */
  profile: string | null
  /** The client's own URL (/c/<id>/mcp): its profile is switched in Switchboard. */
  client?: string
}

export interface ClientDef {
  id: string
  name: string
  format: 'json' | 'toml'
  /** Candidate config files, most likely first. */
  paths(env: ClientEnv): string[]
  /** Key path of the object holding servers. */
  key: string[]
  /** Directory whose existence means the client is installed. */
  detect(env: ClientEnv): string[]
  /** The entry Switchboard writes. */
  entry(target: ConnectTarget): Record<string, unknown>
  docs: string
}

export function defaultClientEnv(): ClientEnv {
  return { home: homedir(), platform: process.platform, appData: process.env.APPDATA }
}

function appSupport(env: ClientEnv, ...parts: string[]): string {
  if (env.platform === 'darwin') return join(env.home, 'Library', 'Application Support', ...parts)
  if (env.platform === 'win32') return join(env.appData ?? join(env.home, 'AppData', 'Roaming'), ...parts)
  return join(env.home, '.config', ...parts)
}

/** The stdio bridge, for clients that cannot connect to HTTP servers. */
export function bridgeEntry(target: Pick<ConnectTarget, 'profile' | 'client'>): Record<string, unknown> {
  const args = ['-y', brand.packageName, 'connect']
  if (target.client) args.push('--client', target.client)
  else if (target.profile) args.push('--profile', target.profile)
  return { command: 'npx', args }
}

export const CLIENTS: ClientDef[] = [
  {
    id: 'cursor',
    name: 'Cursor',
    format: 'json',
    paths: (env) => [join(env.home, '.cursor', 'mcp.json')],
    detect: (env) => [join(env.home, '.cursor')],
    key: ['mcpServers'],
    entry: ({ url }) => ({ url }),
    docs: 'https://cursor.com/docs/context/mcp',
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    format: 'json',
    paths: (env) => [join(env.home, '.claude.json')],
    detect: (env) => [join(env.home, '.claude.json'), join(env.home, '.claude')],
    key: ['mcpServers'],
    entry: ({ url }) => ({ type: 'http', url }),
    docs: 'https://docs.claude.com/en/docs/claude-code/mcp',
  },
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    format: 'json',
    paths: (env) => [appSupport(env, 'Claude', 'claude_desktop_config.json')],
    detect: (env) => [appSupport(env, 'Claude')],
    key: ['mcpServers'],
    // Claude Desktop's config file only runs local commands.
    entry: (target) => bridgeEntry(target),
    docs: 'https://modelcontextprotocol.io/quickstart/user',
  },
  {
    id: 'vscode',
    name: 'VS Code',
    format: 'json',
    paths: (env) => [appSupport(env, 'Code', 'User', 'mcp.json')],
    detect: (env) => [appSupport(env, 'Code')],
    key: ['servers'],
    entry: ({ url }) => ({ type: 'http', url }),
    docs: 'https://code.visualstudio.com/docs/copilot/customization/mcp-servers',
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    format: 'json',
    paths: (env) => [join(env.home, '.codeium', 'windsurf', 'mcp_config.json')],
    detect: (env) => [join(env.home, '.codeium', 'windsurf')],
    key: ['mcpServers'],
    entry: ({ url }) => ({ serverUrl: url }),
    docs: 'https://docs.windsurf.com/windsurf/cascade/mcp',
  },
  {
    id: 'codex',
    name: 'Codex',
    format: 'toml',
    paths: (env) => [join(env.home, '.codex', 'config.toml')],
    detect: (env) => [join(env.home, '.codex')],
    key: ['mcp_servers'],
    entry: ({ url }) => ({ url }),
    docs: 'https://developers.openai.com/codex/mcp',
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    format: 'json',
    paths: (env) => [join(env.home, '.gemini', 'settings.json')],
    detect: (env) => [join(env.home, '.gemini')],
    key: ['mcpServers'],
    entry: ({ url }) => ({ httpUrl: url }),
    docs: 'https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md',
  },
]

export function findClient(id: string): ClientDef | undefined {
  return CLIENTS.find((c) => c.id === id)
}
