import type { ProfileView, ToolEntry } from '../profiles/view.ts'
import { ToolIndex } from './search.ts'
import { toolSignature } from './typescript.ts'

const indexes = new WeakMap<ProfileView, ToolIndex>()

function indexFor(view: ProfileView): ToolIndex {
  let index = indexes.get(view)
  if (!index) {
    index = new ToolIndex(view.tools)
    indexes.set(view, index)
  }
  return index
}

/** The first sentence of a description, for search results. */
export function summary(description: string | undefined, max = 160): string {
  if (!description) return ''
  const flat = description.replace(/\s+/g, ' ').trim()
  const sentence = flat.match(/^.*?[.!?](\s|$)/)?.[0]?.trim() ?? flat
  return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence
}

/** "github (24 tools), linear (12 tools)" */
export function serverOverview(view: ProfileView): string {
  const counts = new Map<string, number>()
  for (const t of view.tools) counts.set(t.server, (counts.get(t.server) ?? 0) + 1)
  return (
    [...counts].map(([server, n]) => `${server} (${n} tool${n === 1 ? '' : 's'})`).join(', ') || 'none yet'
  )
}

export interface FoundTool {
  name: string
  server: string
  description: string
}

export function searchTools(view: ProfileView, query: string, limit = 10): FoundTool[] {
  const q = query.trim()
  // An empty query, a server name or "server.*" lists that server's tools.
  const serverQuery = q.endsWith('.*') ? q.slice(0, -2) : q
  const byServer = view.tools.filter((t) => t.server === serverQuery)
  const entries: ToolEntry[] = !q
    ? view.tools.slice(0, limit)
    : byServer.length
      ? byServer.slice(0, Math.max(limit, 50))
      : indexFor(view)
          .search(q, limit)
          .map((h) => h.entry)
  return entries.map((e) => ({
    name: e.id,
    server: e.server,
    description: summary(e.definition.description),
  }))
}

export function formatSearch(query: string, found: FoundTool[], view: ProfileView): string {
  if (!found.length) {
    return `No tools match "${query}". Servers in this profile: ${serverOverview(view)}. Try other words, or a server name to list its tools.`
  }
  return found.map((t) => (t.description ? `${t.name} - ${t.description}` : t.name)).join('\n')
}

/** Look tools up by `server.tool`, exposed name or bare tool name when unambiguous. */
export function findTool(view: ProfileView, name: string): ToolEntry | undefined {
  const direct = view.byId.get(name) ?? view.byName.get(name)
  if (direct) return direct
  const matches = view.tools.filter((t) => t.tool === name)
  return matches.length === 1 ? matches[0] : undefined
}

export function describeTools(view: ProfileView, names: string[], displayName: (e: ToolEntry) => string) {
  const found: string[] = []
  const missing: string[] = []
  for (const name of names) {
    const entry = findTool(view, name)
    if (!entry) {
      missing.push(name)
      continue
    }
    found.push(toolSignature({ ...entry.definition, name: entry.tool }, '', displayName(entry)))
  }
  let text = found.join('\n\n')
  if (missing.length) {
    text += `${text ? '\n\n' : ''}Not found: ${missing.join(', ')}. Use search_tools to find tool names.`
  }
  return { text, found: found.length, missing }
}
