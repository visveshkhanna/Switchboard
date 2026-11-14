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
  servers: number
  profiles: number
  sessions: number
}

export type ConnectionState = 'stopped' | 'starting' | 'ready' | 'error' | 'needs-auth'

export interface ConnectionStatus {
  name: string
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

export interface ServerRow {
  name: string
  config: ServerConfig
  status?: ConnectionStatus
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
  profile: string
  via: string
  client?: { name: string; version: string }
  surface: 'passthrough' | 'meta' | 'code'
  createdAt: string
  lastSeenAt: string
}

export interface AuditEvent {
  ts: string
  session?: string
  client?: string
  profile: string
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

export interface ClientState {
  id: string
  name: string
  installed: boolean
  configPath: string
  configExists: boolean
  connectedProfile?: string
  /** 'auto' when the entry points at the shared /mcp URL. */
  connectedMode?: 'profile' | 'auto'
  foreignEntry?: boolean
  serverCount: number
  error?: string
  docs: string
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
