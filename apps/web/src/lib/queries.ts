import { type QueryClient, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { ApiError, adminToken, enc, get } from './api.ts'
import { baseUrl } from './snippets.ts'
import type {
  ApiKey,
  AuditEvent,
  ClientRow,
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
  apiKeys: ['api-keys'] as const,
  tools: (name: string) => ['tools', name] as const,
  logs: (name: string) => ['logs', name] as const,
}

export const useApiKeys = () => useQuery({ queryKey: keys.apiKeys, queryFn: () => get<ApiKey[]>('/keys') })

/** Where clients reach the daemon (public URL when hosted). */
export function useBaseUrl(): string {
  const status = useStatus()
  return baseUrl(status.data)
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
  useQuery({ queryKey: keys.clients, queryFn: () => get<ClientRow[]>('/clients') })
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
    let source = open()
    // A page kept in the back/forward cache must not hold its stream open: the browser allows
    // only six connections per host, and frozen pages holding them make every new page hang.
    const onHide = () => source.close()
    const onShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return
      source = open()
      void qc.invalidateQueries()
    }
    window.addEventListener('pagehide', onHide)
    window.addEventListener('pageshow', onShow)
    return () => {
      window.removeEventListener('pagehide', onHide)
      window.removeEventListener('pageshow', onShow)
      source.close()
    }
  }, [qc])
  return state

  function open(): EventSource {
    const source = new EventSource(adminToken ? `/api/events?token=${enc(adminToken)}` : '/api/events', {
      withCredentials: true,
    })
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
      // `status.name` is an instance: the server itself, or one of its accounts (`github.work`).
      qc.setQueryData<ServerRow[]>(keys.servers, (old) =>
        old?.map((row) => {
          const ofRow = row.name === (status.server ?? status.name)
          if (!ofRow) return row
          return {
            ...row,
            status: row.status?.name === status.name || row.name === status.name ? status : row.status,
            instances: row.instances?.map((i) => (i.id === status.name ? { ...i, status } : i)),
          }
        }),
      )
      if (status.state === 'ready') {
        void qc.invalidateQueries({ queryKey: keys.tools(status.name) })
        if (status.server) void qc.invalidateQueries({ queryKey: keys.tools(status.server) })
      }
    })
    source.addEventListener('clients', () => {
      void qc.invalidateQueries({ queryKey: keys.clients })
    })
    source.addEventListener('sessions', (e) => {
      const sessions = parse(e) as SessionInfo[]
      qc.setQueryData(keys.sessions, sessions)
      qc.setQueryData<Status>(keys.status, (old) => (old ? { ...old, sessions: sessions.length } : old))
      // Session counts are part of each client row.
      void qc.invalidateQueries({ queryKey: keys.clients })
    })
    source.addEventListener('config', (e) => {
      const config = parse(e) as ConfigWithSettings
      qc.setQueryData(keys.config, config)
      if (config.settings) qc.setQueryData(keys.settings, config.settings)
      void qc.invalidateQueries({ queryKey: keys.servers })
      void qc.invalidateQueries({ queryKey: keys.status })
      void qc.invalidateQueries({ queryKey: keys.import })
      // Rules, choices or the default changed: what each client gets may have too.
      void qc.invalidateQueries({ queryKey: keys.clients })
    })
    return source
  }
}
