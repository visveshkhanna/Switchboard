import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import type { Surface } from '@switchboard/shared'
import type { CallContext, Gateway } from '../gateway.ts'
import type { ProfileView } from '../profiles/view.ts'

export type ConcreteSurface = Exclude<Surface, 'auto'>

/** How a profile's tools are presented to a client. */
export interface ToolSurface {
  readonly kind: ConcreteSurface
  listTools(view: ProfileView): Tool[]
  callTool(
    name: string,
    args: Record<string, unknown> | undefined,
    view: ProfileView,
    ctx: Omit<CallContext, 'via'>,
  ): Promise<CallToolResult>
  /** Text for the MCP `instructions` field. */
  instructions(view: ProfileView): string | undefined
}

export interface SurfaceDeps {
  gateway: Gateway
}

export function pickSurface(view: ProfileView): ConcreteSurface {
  const { surface, autoThreshold } = view.profile
  if (surface !== 'auto') return surface
  return view.tools.length > autoThreshold ? 'meta' : 'passthrough'
}
