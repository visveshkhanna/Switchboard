import { createHash } from 'node:crypto'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { type Config, instanceFor, matchGlob, matchToolPattern, type Profile } from '@switchboard/shared'
import type { Catalog } from '../catalog.ts'

/** Many clients reject tool names longer than 64 characters. */
export const MAX_TOOL_NAME = 64

export interface ToolEntry {
  server: string
  /** The instance that serves this profile: the server's name, or `<server>.<account>`. */
  instance: string
  /** The tool's name on its server. */
  tool: string
  /** `server.tool`, the canonical id used in config and logs. */
  id: string
  /** The name the client sees. */
  name: string
  definition: Tool
}

export interface ProfileView {
  name: string
  profile: Profile
  tools: ToolEntry[]
  byName: Map<string, ToolEntry>
  byId: Map<string, ToolEntry>
  /** Servers this profile can draw tools from. */
  servers: string[]
  /** The instance this profile uses for each of its servers, in the same order. */
  instances: string[]
  /** Server instructions, for servers that have them. */
  instructions: Map<string, string>
}

export function sanitizeName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '_')
}

function shortHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 6)
}

/** `server__tool`, made safe for clients and kept within 64 characters. */
export function exposedToolName(server: string, tool: string): string {
  const name = sanitizeName(`${server}__${tool}`)
  if (name.length <= MAX_TOOL_NAME) return name
  return `${name.slice(0, MAX_TOOL_NAME - 7)}_${shortHash(`${server}.${tool}`)}`
}

/** The servers a profile can use: listed ones plus any matched by `include`. */
export function profileServers(profile: Profile, config: Config): string[] {
  const names = new Set(profile.servers)
  for (const pattern of profile.include) {
    const serverGlob = pattern.slice(0, pattern.indexOf('.'))
    for (const server of Object.keys(config.servers)) if (matchGlob(serverGlob, server)) names.add(server)
  }
  return [...names].filter((s) => config.servers[s]?.enabled)
}

export function buildProfileView(name: string, config: Config, catalog: Catalog): ProfileView {
  const profile = config.profiles[name]
  if (!profile) throw new Error(`Unknown profile "${name}"`)
  const servers = profileServers(profile, config)
  const listed = new Set(profile.servers)
  const tools: ToolEntry[] = []
  const byName = new Map<string, ToolEntry>()
  const byId = new Map<string, ToolEntry>()
  const instructions = new Map<string, string>()

  servers.sort()
  const instances = servers.map((server) => instanceFor(config, name, server))
  servers.forEach((server, index) => {
    const instance = instances[index]!
    const entry = catalog.get(instance)
    if (!entry) return
    if (entry.instructions) instructions.set(server, entry.instructions)
    for (const tool of entry.tools) {
      const included =
        listed.has(server) || profile.include.some((p) => matchToolPattern(p, server, tool.name))
      if (!included) continue
      if (profile.exclude.some((p) => matchToolPattern(p, server, tool.name))) continue
      const id = `${server}.${tool.name}`
      const override = profile.overrides[id]
      let exposed = override?.name
        ? sanitizeName(override.name).slice(0, MAX_TOOL_NAME)
        : exposedToolName(server, tool.name)
      if (byName.has(exposed)) exposed = `${exposed.slice(0, MAX_TOOL_NAME - 7)}_${shortHash(id)}`
      const definition: Tool = {
        ...tool,
        name: exposed,
        description: override?.description ?? tool.description,
      }
      const toolEntry: ToolEntry = { server, instance, tool: tool.name, id, name: exposed, definition }
      tools.push(toolEntry)
      byName.set(exposed, toolEntry)
      byId.set(id, toolEntry)
    }
  })
  return { name, profile, tools, byName, byId, servers, instances, instructions }
}

/** Caches views until the config or the catalog changes. */
export class ProfileViews {
  #cache = new Map<string, { key: string; view: ProfileView }>()

  constructor(
    private readonly getConfig: () => { config: Config; revision: number },
    private readonly catalog: Catalog,
  ) {}

  get(name: string): ProfileView {
    const { config, revision } = this.getConfig()
    const key = `${revision}:${this.catalog.revision}`
    const cached = this.#cache.get(name)
    if (cached?.key === key) return cached.view
    const view = buildProfileView(name, config, this.catalog)
    this.#cache.set(name, { key, view })
    return view
  }
}
