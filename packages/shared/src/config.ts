import { z } from 'zod'

/** Names of servers and profiles: used in URLs and tool names. */
export const slugSchema = z
  .string()
  .min(1)
  .max(48)
  .regex(
    /^[a-z0-9][a-z0-9_-]*$/,
    'use lowercase letters, digits, "-" and "_", starting with a letter or digit',
  )

const stringRecord = z.record(z.string(), z.string())

const serverBase = {
  enabled: z.boolean().default(true),
  description: z.string().optional(),
  /** Stop the server after this many seconds without a call. 0 keeps it running. */
  idleTimeoutSec: z.number().int().min(0).default(600),
  /** Per-call timeout. */
  callTimeoutSec: z.number().int().min(1).default(120),
}

export const stdioServerSchema = z.object({
  ...serverBase,
  transport: z.literal('stdio'),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: stringRecord.default({}),
  cwd: z.string().optional(),
})

export const httpServerSchema = z.object({
  ...serverBase,
  /** `http` tries Streamable HTTP and falls back to SSE; `sse` uses SSE only. */
  transport: z.enum(['http', 'sse']),
  url: z.url(),
  headers: stringRecord.default({}),
})

export const serverConfigSchema = z.discriminatedUnion('transport', [stdioServerSchema, httpServerSchema])
export type ServerConfig = z.infer<typeof serverConfigSchema>
export type ServerConfigInput = z.input<typeof serverConfigSchema>

export const surfaceSchema = z.enum(['auto', 'passthrough', 'meta', 'code'])
export type Surface = z.infer<typeof surfaceSchema>

export const budgetsSchema = z.object({
  timeoutMs: z.number().int().min(100).max(600_000).default(30_000),
  maxToolCalls: z.number().int().min(1).max(10_000).default(64),
  maxSourceBytes: z
    .number()
    .int()
    .min(256)
    .default(64 * 1024),
  maxResultChars: z.number().int().min(1_000).default(24_000),
  memoryMb: z.number().int().min(8).max(1024).default(64),
})
export type Budgets = z.infer<typeof budgetsSchema>

/**
 * Tool patterns: `server.*` for every tool of a server, `server.tool` for one
 * tool, and `*` wildcards inside either part (`github.list_*`).
 */
export const toolPatternSchema = z.string().regex(/^[^.\s]+\.[^\s]+$/, 'use "server.tool" or "server.*"')

export const toolOverrideSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
})

export const profileSchema = z.object({
  description: z.string().optional(),
  /** Every tool of these servers is included. */
  servers: z.array(slugSchema).default([]),
  /** Extra tools to include from servers not listed above. */
  include: z.array(toolPatternSchema).default([]),
  /** Removed last, so they win over `servers` and `include`. */
  exclude: z.array(toolPatternSchema).default([]),
  /** Keyed by `server.tool`. */
  overrides: z.record(z.string(), toolOverrideSchema).default({}),
  surface: surfaceSchema.default('auto'),
  /** With `auto`, profiles with more tools than this use the `meta` surface. */
  autoThreshold: z.number().int().min(0).default(40),
  budgets: budgetsSchema.default(budgetsSchema.parse({})),
})
export type Profile = z.infer<typeof profileSchema>
export type ProfileInput = z.input<typeof profileSchema>

export const clientRuleSchema = z.object({
  /** Glob matched against the MCP `clientInfo.name`, case-insensitively: `cursor*`. */
  client: z.string().min(1),
  profile: slugSchema,
})
export type ClientRule = z.infer<typeof clientRuleSchema>

/**
 * A client's profile. `profile` set: that profile. `null`: no profile (the
 * client gets no tools). Absent: the default profile.
 */
export const clientSchema = z.object({
  /** Display name, e.g. the MCP clientInfo.name it connected with. */
  name: z.string().max(200).optional(),
  profile: slugSchema.nullable().optional(),
})
export type ClientConfig = z.infer<typeof clientSchema>

export const settingsSchema = z.object({
  /** Keep tool-call activity in audit.jsonl. Unset until the user has been asked. */
  activityLog: z.boolean().optional(),
  /** Days of activity to keep on disk. */
  retentionDays: z.number().int().min(1).max(365).default(30),
})
export type Settings = z.infer<typeof settingsSchema>

export const configSchema = z.object({
  $schema: z.string().optional(),
  version: z.literal(1).default(1),
  servers: z.record(slugSchema, serverConfigSchema).default({}),
  profiles: z.record(slugSchema, profileSchema).default({}),
  /** Each client's profile, keyed by client id (the /c/<id>/mcp path, or the slug of its MCP name). */
  clients: z.record(slugSchema, clientSchema).default({}),
  /** Glob rules on the MCP client name, for clients without their own entry. The first match wins. */
  clientRules: z.array(clientRuleSchema).default([]),
  /** Used when nothing else picks a profile. Unset means such connections are refused. */
  defaultProfile: slugSchema.optional(),
  settings: settingsSchema.default(settingsSchema.parse({})),
})
export type Config = z.infer<typeof configSchema>
export type ConfigInput = z.input<typeof configSchema>

export function parseConfig(input: unknown): Config {
  const config = configSchema.parse(input)
  const problems: string[] = []
  for (const [name, profile] of Object.entries(config.profiles)) {
    for (const server of profile.servers) {
      if (!config.servers[server]) problems.push(`profile "${name}" lists unknown server "${server}"`)
    }
  }
  for (const [id, client] of Object.entries(config.clients)) {
    if (client.profile && !config.profiles[client.profile])
      problems.push(`client "${id}" uses unknown profile "${client.profile}"`)
  }
  for (const rule of config.clientRules) {
    if (!config.profiles[rule.profile])
      problems.push(`client rule "${rule.client}" points at unknown profile "${rule.profile}"`)
  }
  if (config.defaultProfile && !config.profiles[config.defaultProfile]) {
    problems.push(`defaultProfile "${config.defaultProfile}" does not exist`)
  }
  if (problems.length) throw new ConfigError(problems)
  return config
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid configuration:\n- ${problems.join('\n- ')}`)
    this.name = 'ConfigError'
  }
}
