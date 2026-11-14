import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { errorResult } from '../gateway.ts'
import type { ProfileView } from '../profiles/view.ts'
import { describeTools, findTool, formatSearch, searchTools, serverOverview } from './discovery.ts'
import { serverInstructions } from './passthrough.ts'
import type { SurfaceDeps, ToolSurface } from './types.ts'

export const META_TOOLS = ['search_tools', 'get_schema', 'call_tool'] as const

export function searchToolDefinition(view: ProfileView, extra = ''): Tool {
  return {
    name: 'search_tools',
    title: 'Search tools',
    description:
      `Search the tools available to you and get their names. Call this first whenever a task might need an external system. Never tell the user a capability is unavailable until you have searched for it.${extra}\n\n` +
      `Servers: ${serverOverview(view)}. Search with a few keywords ("create issue", "send message"), or a server name to list all of its tools.`,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keywords describing the action, or a server name.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Maximum results. Default 10.' },
      },
      required: ['query'],
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }
}

export const getSchemaDefinition: Tool = {
  name: 'get_schema',
  title: 'Get tool schemas',
  description:
    'Get the input types of tools found with search_tools, as TypeScript signatures with descriptions. Call it before calling a tool for the first time.',
  inputSchema: {
    type: 'object',
    properties: {
      names: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 20,
        description: 'Tool names from search_tools, like "github.create_issue".',
      },
    },
    required: ['names'],
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
}

const callToolDefinition: Tool = {
  name: 'call_tool',
  title: 'Call a tool',
  description:
    'Call a tool by the name search_tools returned, with arguments matching the schema from get_schema. The result is the tool’s own result.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The tool name, like "github.create_issue".' },
      arguments: { type: 'object', description: 'The tool’s arguments.', additionalProperties: true },
    },
    required: ['name'],
  },
}

/**
 * Three tools instead of hundreds: search, read the schema, call. Keeps the
 * tool list a constant size however many servers a profile has.
 */
export function metaSurface({ gateway }: SurfaceDeps): ToolSurface {
  return {
    kind: 'meta',
    listTools: (view) => [searchToolDefinition(view), getSchemaDefinition, callToolDefinition],
    async callTool(name, args = {}, view, ctx) {
      switch (name) {
        case 'search_tools': {
          const query = typeof args.query === 'string' ? args.query : ''
          const limit = clampLimit(args.limit)
          return {
            content: [{ type: 'text', text: formatSearch(query, searchTools(view, query, limit), view) }],
          }
        }
        case 'get_schema': {
          const names = normalizeNames(args.names ?? args.name)
          if (!names.length) return errorResult('Pass "names": a list of tool names from search_tools.')
          const { text, found } = describeTools(view, names, (e) => e.id)
          return { content: [{ type: 'text', text }], isError: found === 0 }
        }
        case 'call_tool': {
          const toolName = typeof args.name === 'string' ? args.name : ''
          const entry = findTool(view, toolName)
          if (!entry) {
            return errorResult(`Unknown tool "${toolName}". Use search_tools to find the exact name.`)
          }
          const toolArgs = (args.arguments ?? {}) as Record<string, unknown>
          return gateway.call(entry.id, toolArgs, { ...ctx, via: 'call_tool' })
        }
        default:
          return errorResult(
            `Unknown tool "${name}". This profile offers search_tools, get_schema and call_tool.`,
          )
      }
    },
    instructions(view) {
      const base =
        'Tools are reached through search_tools, get_schema and call_tool. Search before saying a capability is unavailable.'
      const servers = serverInstructions(view)
      return servers ? `${base}\n\n${servers}` : base
    },
  }
}

function clampLimit(value: unknown): number {
  const n = typeof value === 'number' ? Math.floor(value) : 10
  return Math.min(50, Math.max(1, n))
}

export function normalizeNames(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string').slice(0, 20)
  return []
}
