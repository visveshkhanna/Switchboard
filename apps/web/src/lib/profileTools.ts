import { matchGlob, matchToolPattern, type Profile } from '@switchboard/shared'

export interface ToolState {
  active: boolean
  /** Exclude patterns, other than the exact `server.tool`, that remove this tool. */
  blockedBy: string[]
}

export function toolState(p: Profile, server: string, tool: string): ToolState {
  const id = `${server}.${tool}`
  const included = p.servers.includes(server) || p.include.some((x) => matchToolPattern(x, server, tool))
  const excludedBy = p.exclude.filter((x) => matchToolPattern(x, server, tool))
  return { active: included && excludedBy.length === 0, blockedBy: excludedBy.filter((x) => x !== id) }
}

/** Turn one tool on or off by editing the profile's include/exclude lists as little as possible. */
export function setTool(p: Profile, server: string, tool: string, on: boolean): Profile {
  const id = `${server}.${tool}`
  let include = p.include
  let exclude = p.exclude
  if (on) {
    exclude = exclude.filter((x) => x !== id)
    const included = p.servers.includes(server) || include.some((x) => matchToolPattern(x, server, tool))
    if (!included) include = [...include, id]
  } else {
    if (!p.servers.includes(server)) include = include.filter((x) => x !== id)
    const stillIncluded = p.servers.includes(server) || include.some((x) => matchToolPattern(x, server, tool))
    if (stillIncluded && !exclude.some((x) => matchToolPattern(x, server, tool))) exclude = [...exclude, id]
  }
  return { ...p, include, exclude }
}

/** Servers that can contribute tools: the listed ones, plus any named by an include pattern. */
export function candidateServers(p: Profile, all: string[]): string[] {
  const out = new Set(p.servers)
  for (const pattern of p.include) {
    const glob = pattern.slice(0, pattern.indexOf('.'))
    for (const s of all) if (matchGlob(glob, s)) out.add(s)
  }
  return all.filter((s) => out.has(s))
}

export const PATTERN_RE = /^[^.\s]+\.[^\s]+$/
