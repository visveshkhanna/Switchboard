import { brand, type Config, matchGlob } from '@switchboard/shared'

export interface ResolveInput {
  /** From the URL: /p/:profile/mcp */
  path?: string
  /** From the X-Switchboard-Profile header. */
  header?: string
  /** `clientInfo.name` from the MCP initialize request. */
  clientName?: string
}

export type Resolution =
  | { ok: true; profile: string; via: 'path' | 'header' | 'client-rule' | 'default' }
  | { ok: false; reason: 'unknown-profile' | 'unmatched'; message: string }

/** Pick a profile: URL path, then header, then client rules, then the default. */
export function resolveProfile(input: ResolveInput, config: Config): Resolution {
  const known = Object.keys(config.profiles)
  const check = (name: string, via: 'path' | 'header'): Resolution =>
    config.profiles[name]
      ? { ok: true, profile: name, via }
      : {
          ok: false,
          reason: 'unknown-profile',
          message: `Unknown ${brand.displayName} profile "${name}". Profiles: ${known.join(', ') || '(none yet)'}.`,
        }

  if (input.path) return check(input.path, 'path')
  if (input.header) return check(input.header.trim(), 'header')
  if (input.clientName) {
    const rule = config.clientRules.find((r) => matchGlob(r.client, input.clientName!))
    if (rule) return { ok: true, profile: rule.profile, via: 'client-rule' }
  }
  if (config.defaultProfile) return { ok: true, profile: config.defaultProfile, via: 'default' }
  return {
    ok: false,
    reason: 'unmatched',
    message:
      `No ${brand.displayName} profile for this client${input.clientName ? ` ("${input.clientName}")` : ''}. ` +
      `Use the URL /p/<profile>/mcp, the ${brand.profileHeader} header, a client rule or a default profile. ` +
      `Profiles: ${known.join(', ') || '(none yet)'}.`,
  }
}
