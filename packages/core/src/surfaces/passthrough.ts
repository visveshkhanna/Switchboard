import { errorResult } from '../gateway.ts'
import type { ProfileView } from '../profiles/view.ts'
import type { SurfaceDeps, ToolSurface } from './types.ts'

/** Every allowed tool, as is, named `server__tool`. */
export function passthroughSurface({ gateway }: SurfaceDeps): ToolSurface {
  return {
    kind: 'passthrough',
    listTools: (view) => view.tools.map((t) => t.definition),
    callTool: async (name, args, view, ctx) => {
      if (!view.byName.has(name)) {
        return errorResult(`Unknown tool "${name}". It may have been removed from profile "${view.name}".`)
      }
      return gateway.call(name, args, { ...ctx, via: 'direct' })
    },
    instructions: (view) => serverInstructions(view),
  }
}

export function serverInstructions(view: ProfileView): string | undefined {
  if (!view.instructions.size) return view.profile.description
  const parts = view.profile.description ? [view.profile.description] : []
  for (const [server, text] of view.instructions) parts.push(`## ${server}\n${text.trim()}`)
  return parts.join('\n\n')
}
