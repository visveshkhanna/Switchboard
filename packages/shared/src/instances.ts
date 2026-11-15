import type { Config, Credential, ServerConfig } from './config.ts'
import { matchGlob } from './patterns.ts'

/**
 * One running copy of a server. Every server has a default instance, named
 * after the server; a profile with its own credentials for the server gets
 * an account instance, `<server>.<account>`, with those credentials merged in.
 */
export interface ServerInstance {
  /** `github`, or `github.work` for an account. */
  id: string
  server: string
  /** The account name, or null for the default instance. */
  account: string | null
  /** Profiles served by this instance. */
  profiles: string[]
  /** The server's config with the account's credentials merged in. */
  config: ServerConfig
}

export const instanceId = (server: string, account: string | null) =>
  account ? `${server}.${account}` : server

/** Split an instance id into its server and account. */
export function parseInstanceId(id: string): { server: string; account: string | null } {
  const dot = id.indexOf('.')
  return dot < 0 ? { server: id, account: null } : { server: id.slice(0, dot), account: id.slice(dot + 1) }
}

const accountOf = (profile: string, credential: Credential) => credential.account ?? profile

/** The instance a profile uses for a server. */
export function instanceFor(config: Config, profile: string, server: string): string {
  const credential = config.profiles[profile]?.credentials[server]
  return credential ? instanceId(server, accountOf(profile, credential)) : server
}

function merge(server: ServerConfig, credential: Credential): ServerConfig {
  if (server.transport === 'stdio') return { ...server, env: { ...server.env, ...credential.env } }
  return { ...server, headers: { ...server.headers, ...credential.headers } }
}

/** Profiles that use a server: listed in `servers`, or matched by an `include` pattern. */
function profilesUsing(config: Config, server: string): string[] {
  return Object.entries(config.profiles)
    .filter(
      ([, p]) =>
        p.servers.includes(server) ||
        p.include.some((pattern) => matchGlob(pattern.slice(0, pattern.indexOf('.')), server)),
    )
    .map(([name]) => name)
}

/**
 * Every instance the config needs. A server's default instance is left out
 * when profiles use the server and every one of them has its own account:
 * it would only run without the credentials it needs.
 */
export function serverInstances(config: Config): ServerInstance[] {
  const out: ServerInstance[] = []
  for (const [server, base] of Object.entries(config.servers)) {
    const users = profilesUsing(config, server)
    const accounts = new Map<string, ServerInstance>()
    const shared: string[] = []
    for (const profile of users) {
      const credential = config.profiles[profile]!.credentials[server]
      if (!credential) {
        shared.push(profile)
        continue
      }
      const account = accountOf(profile, credential)
      const existing = accounts.get(account)
      if (existing) existing.profiles.push(profile)
      else
        accounts.set(account, {
          id: instanceId(server, account),
          server,
          account,
          profiles: [profile],
          config: merge(base, credential),
        })
    }
    if (shared.length || !accounts.size) {
      out.push({ id: server, server, account: null, profiles: shared, config: base })
    }
    out.push(...accounts.values())
  }
  return out
}

/** Profiles that name the same account for a server must give it the same credentials. */
export function accountConflicts(config: Config): string[] {
  const seen = new Map<string, { profile: string; key: string }>()
  const problems: string[] = []
  for (const [profile, p] of Object.entries(config.profiles)) {
    for (const [server, credential] of Object.entries(p.credentials)) {
      const id = instanceId(server, accountOf(profile, credential))
      const key = JSON.stringify([credential.env, credential.headers])
      const first = seen.get(id)
      if (!first) seen.set(id, { profile, key })
      else if (first.key !== key) {
        problems.push(
          `profiles "${first.profile}" and "${profile}" both use account "${id}" with different credentials; give one of them its own account name`,
        )
      }
    }
  }
  return problems
}
