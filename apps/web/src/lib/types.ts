import type { Config, Profile, ServerConfig, Surface } from '@switchboard/shared'

export type { Config, Profile, ServerConfig, Surface }

/** Mirrors of the daemon's API payloads (packages/core). */
export interface Status {
  name: string
  version: string
  pid: number
  port?: number
  startedAt?: string
  home: string
  configPath: string
  secretsBackend: string
  /** True when hosted: web UI behind a login, MCP clients need API keys. */
  remote?: boolean
  /** Where clients reach the daemon: the public URL when hosted. */
  baseUrl?: string
  /** Number of API keys. */
  keys?: number
  servers: number
  profiles: number
  sessions: number
}

export type ConnectionState = 'stopped' | 'starting' | 'ready' | 'error' | 'needs-auth'

export interface ConnectionStatus {
  /** The instance id: the server's name, or `server.account`. */
  name: string
  /** Older daemons omit these. */
  server?: string
  account?: string | null
  transport: ServerConfig['transport']
  enabled: boolean
  state: ConnectionState
  lastError?: string
  startedAt?: string
  lastUsedAt?: string
  inFlight: number
  toolCount?: number
  syncedAt?: string
  pid?: number
  /** Automatic restarts after crashes. Older daemons omit it. */
  restarts?: number
  /** ISO time of the next automatic restart, while in the error state. */
  nextRestartAt?: string
  /** True when idleTimeoutSec is 0: started with the daemon and restarted after crashes. */
  keepRunning?: boolean
  /** Sign-in URL, when state is 'needs-auth'. */
  authUrl?: string
}

/** One running copy of a server: its default, or a profile's own account. */
export interface ServerInstanceRow {
  id: string
  account: string | null
  profiles: string[]
  status?: ConnectionStatus
}

export interface ServerRow {
  name: string
  config: ServerConfig
  /** The default instance, or the first account when every profile has its own. */
  status?: ConnectionStatus
  /** Older daemons omit it. */
  instances?: ServerInstanceRow[]
}

export interface ToolDef {
  name: string
  description?: string
  inputSchema?: unknown
}

export type TestResult =
  | { ok: true; tools: { name: string; description?: string }[] }
  | { ok: false; error: string; stderr?: string[] }

export interface SessionInfo {
  id: string
  /** null while the client waits for a profile (`via: 'unassigned'`). */
  profile: string | null
  via: string
  client?: { name: string; version: string }
  /** null while waiting for a profile. */
  surface: 'passthrough' | 'meta' | 'code' | null
  createdAt: string
  lastSeenAt: string
}

export interface AuditEvent {
  ts: string
  session?: string
  client?: string
  profile: string | null
  tool: string
  via: 'direct' | 'call_tool' | 'code'
  server?: string
  durationMs: number
  ok: boolean
  error?: string
}

export interface Preview {
  surface: 'passthrough' | 'meta' | 'code'
  tools: { id: string; name: string; server: string; description?: string }[]
  listed: string[]
  tokens: { listed: number; passthrough: number }
  missingServers: string[]
}

export type ClientSetup = 'managed' | 'profile' | 'auto' | 'none' | 'foreign'

/** A client: a preset Switchboard can configure, one that has connected, or both. */
export interface ClientRow {
  id: string
  name: string
  /** The MCP clientInfo.name it last reported. */
  clientInfoName: string | null
  version: string | null
  firstSeen: string | null
  lastSeen: string | null
  /** What the user chose: a profile, everything off, or follow the default. */
  selection: 'default' | 'off' | 'profile'
  profile: string | null
  /** What the client gets now. */
  effectiveProfile: string | null
  via: 'client' | 'client-rule' | 'default' | 'unassigned' | 'disabled'
  sessions: number
  waiting: number
  /** The client's own URL, /c/<id>/mcp. */
  url: string
  preset: null | {
    installed: boolean
    configPath: string
    configExists: boolean
    docs: string
    error: string | null
    setup: ClientSetup
    pinnedProfile: string | null
    managedId: string | null
    otherServers: number
  }
}

export interface ImportCandidate {
  client: string
  originalName: string
  name: string
  server: Record<string, unknown> & { transport: ServerConfig['transport'] }
  exists: boolean
}

export interface Secrets {
  backend: string
  names: string[]
}

export interface Settings {
  /** null until the user has chosen. */
  activityLog: boolean | null
  retentionDays: number
}

export type ConfigWithSettings = Config & { settings?: Settings }

export type StatsRange = '1h' | '24h' | '7d' | '30d'

export interface Stats {
  range: StatsRange
  bucketMs: number
  source: 'file' | 'memory'
  totals: { calls: number; errors: number; p50: number; p95: number }
  buckets: { t: number; calls: number; errors: number; p50: number; p95: number }[]
  tools: { tool: string; server: string; calls: number; errors: number; avgMs: number }[]
  servers: { server: string; calls: number; errors: number }[]
  clients: { client: string; calls: number }[]
  profiles: { profile: string; calls: number }[]
}

/** An API key; the secret token is only returned once, at creation. */
export interface ApiKey {
  id: string
  client: string
  label?: string
  createdAt: string
  lastUsedAt?: string
}

export interface CreatedApiKey {
  token: string
  key: ApiKey
  url: string
}
