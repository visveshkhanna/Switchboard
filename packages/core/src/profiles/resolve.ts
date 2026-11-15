import { brand, type Config, clientId, matchGlob } from '@switchboard/shared'

export interface ResolveInput {
  /** From the URL: /p/:profile/mcp */
  path?: string
  /** From the X-Switchboard-Profile header. */
  header?: string
  /** From the URL: /c/:client/mcp. Otherwise derived from the client name. */
  clientId?: string
  /** `clientInfo.name` from the MCP initialize request. */
  clientName?: string
}

export type ResolvedBy = 'path' | 'header' | 'client' | 'client-rule' | 'default'

export type Resolution =
  | { ok: true; profile: string; via: ResolvedBy }
  | { ok: false; reason: 'unknown-profile' | 'unmatched' | 'disabled'; message: string }

/** The id a connection is known by: the /c/<id>/mcp path, or its MCP client name. */
export function connectionClientId(input: Pick<ResolveInput, 'clientId' | 'clientName'>): string | undefined {
  if (input.clientId) return input.clientId
  return input.clientName ? clientId(input.clientName) : undefined
}

/**
 * Pick a profile: a profile in the URL path or header wins; then the
 * client's own profile; then client rules on its name; then the default.
 */
export function resolveProfile(input: ResolveInput, config: Config): Resolution {
  const known = Object.keys(config.profiles)
  const list = known.join(', ') || '(none yet)'
  const check = (name: string, via: 'path' | 'header'): Resolution =>
    config.profiles[name]
      ? { ok: true, profile: name, via }
      : {
          ok: false,
          reason: 'unknown-profile',
          message: `Unknown ${brand.displayName} profile "${name}". Profiles: ${list}.`,
        }

  if (input.path) return check(input.path, 'path')
  if (input.header) return check(input.header.trim(), 'header')

  const id = connectionClientId(input)
  const own = id ? config.clients[id] : undefined
  if (own && own.profile !== undefined) {
    if (own.profile === null) {
      return {
        ok: false,
        reason: 'disabled',
        message: `Every profile is switched off for this client ("${id}"). Turn one on in ${brand.displayName}.`,
      }
    }
    if (config.profiles[own.profile]) return { ok: true, profile: own.profile, via: 'client' }
  }
  const name = input.clientName ?? id
  if (name) {
    const rule = config.clientRules.find((r) => matchGlob(r.client, name))
    if (rule) return { ok: true, profile: rule.profile, via: 'client-rule' }
  }
  if (config.defaultProfile) return { ok: true, profile: config.defaultProfile, via: 'default' }
  return {
    ok: false,
    reason: 'unmatched',
    message:
      `No ${brand.displayName} profile for this client${id ? ` ("${id}")` : ''}. ` +
      `Turn a profile on for it in ${brand.displayName}, or set a default profile. Profiles: ${list}.`,
  }
}
