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

export type ConnectionState = 'stopped' | 'starting' | 'ready' | 'error'

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
