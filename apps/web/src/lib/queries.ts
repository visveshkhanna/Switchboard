import { type QueryClient, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { ApiError, adminToken, enc, get } from './api.ts'
import type {
  AuditEvent,
  ClientState,
  ConfigWithSettings,
  ConnectionStatus,
  ImportCandidate,
  Secrets,
  ServerRow,
  SessionInfo,
  Settings,
  Stats,
  StatsRange,
  Status,
  ToolDef,
} from './types.ts'

export const keys = {
  status: ['status'] as const,
  config: ['config'] as const,
  servers: ['servers'] as const,
  sessions: ['sessions'] as const,
  audit: ['audit'] as const,
  clients: ['clients'] as const,
  secrets: ['secrets'] as const,
  import: ['import'] as const,
  settings: ['settings'] as const,
  stats: (range: StatsRange) => ['stats', range] as const,
  tools: (name: string) => ['tools', name] as const,
  logs: (name: string) => ['logs', name] as const,
}

export const useStatus = () => useQuery({ queryKey: keys.status, queryFn: () => get<Status>('/status') })
export const useConfig = () =>
  useQuery({ queryKey: keys.config, queryFn: () => get<ConfigWithSettings>('/config') })
export const useServers = () =>
  useQuery({ queryKey: keys.servers, queryFn: () => get<ServerRow[]>('/servers') })
export const useSessions = () =>
  useQuery({ queryKey: keys.sessions, queryFn: () => get<SessionInfo[]>('/sessions') })
export const useAudit = () =>
  useQuery({ queryKey: keys.audit, queryFn: () => get<AuditEvent[]>('/audit?limit=500') })
export const useClients = () =>
  useQuery({ queryKey: keys.clients, queryFn: () => get<ClientState[]>('/clients') })
export const useSecrets = () => useQuery({ queryKey: keys.secrets, queryFn: () => get<Secrets>('/secrets') })
export const useImport = () =>
  useQuery({ queryKey: keys.import, queryFn: () => get<ImportCandidate[]>('/import') })
/** Resolve to null when the daemon is too old to have this endpoint. */
async function optional<T>(path: string): Promise<T | null> {
  try {
    return await get<T>(path)
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 405)) return null
    throw error
  }
}

/** Activity-log settings; null when the daemon does not support them. */
export const useSettings = () =>
  useQuery({ queryKey: keys.settings, queryFn: () => optional<Settings>('/settings') })
/** Usage statistics; null when the daemon does not support them. */
export const useStats = (range: StatsRange) =>
  useQuery({
    queryKey: keys.stats(range),
    queryFn: () => optional<Stats>(`/stats?range=${range}`),
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  })
export const useTools = (name: string, enabled = true) =>
  useQuery({
    queryKey: keys.tools(name),
    queryFn: () => get<ToolDef[]>(`/servers/${enc(name)}/tools`),
    enabled,
  })
export const useLogs = (name: string) =>
  useQuery({
    queryKey: keys.logs(name),
    queryFn: () => get<string[]>(`/servers/${enc(name)}/logs`),
    refetchInterval: 3000,
  })

export type LiveState = 'connecting' | 'live' | 'offline'

/** One EventSource for the whole app; events patch or invalidate cached queries. */
export function useLiveEvents(qc: QueryClient): LiveState {
  const [state, setState] = useState<LiveState>('connecting')
  useEffect(() => {
    const source = new EventSource(`/api/events?token=${enc(adminToken)}`)
    const parse = (e: Event) => JSON.parse((e as MessageEvent<string>).data) as unknown
    let wasLive = false
    source.onopen = () => {
      setState('live')
      // Catch up on anything missed while disconnected.
      if (wasLive) void qc.invalidateQueries()
      wasLive = true
    }
    source.onerror = () => setState(source.readyState === EventSource.CLOSED ? 'offline' : 'connecting')
    source.addEventListener('audit', (e) => {
      const event = parse(e) as AuditEvent
      qc.setQueryData<AuditEvent[]>(keys.audit, (old) => (old ? [event, ...old].slice(0, 1000) : old))
      // A new call is the first sign a client is connected; refresh onboarding state lazily.
      void qc.invalidateQueries({ queryKey: ['stats'], refetchType: 'none' })
    })
    source.addEventListener('server', (e) => {
      const status = parse(e) as ConnectionStatus
      qc.setQueryData<ServerRow[]>(keys.servers, (old) =>
        old?.map((row) => (row.name === status.name ? { ...row, status } : row)),
      )
      if (status.state === 'ready') void qc.invalidateQueries({ queryKey: keys.tools(status.name) })
    })
    source.addEventListener('sessions', (e) => {
      const sessions = parse(e) as SessionInfo[]
      qc.setQueryData(keys.sessions, sessions)
      qc.setQueryData<Status>(keys.status, (old) => (old ? { ...old, sessions: sessions.length } : old))
    })
    source.addEventListener('config', (e) => {
      const config = parse(e) as ConfigWithSettings
      qc.setQueryData(keys.config, config)
      if (config.settings) qc.setQueryData(keys.settings, config.settings)
      void qc.invalidateQueries({ queryKey: keys.servers })
      void qc.invalidateQueries({ queryKey: keys.status })
      void qc.invalidateQueries({ queryKey: keys.import })
    })
    return () => source.close()
  }, [qc])
  return state
}
