import { type QueryClient, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { adminToken, enc, get } from './api.ts'
import type {
  AuditEvent,
  ClientState,
  Config,
  ConnectionStatus,
  ImportCandidate,
  Secrets,
  ServerRow,
  SessionInfo,
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
  tools: (name: string) => ['tools', name] as const,
  logs: (name: string) => ['logs', name] as const,
}

export const useStatus = () => useQuery({ queryKey: keys.status, queryFn: () => get<Status>('/status') })
export const useConfig = () => useQuery({ queryKey: keys.config, queryFn: () => get<Config>('/config') })
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
      qc.setQueryData(keys.config, parse(e) as Config)
      void qc.invalidateQueries({ queryKey: keys.servers })
      void qc.invalidateQueries({ queryKey: keys.status })
      void qc.invalidateQueries({ queryKey: keys.import })
    })
    return () => source.close()
  }, [qc])
  return state
}
