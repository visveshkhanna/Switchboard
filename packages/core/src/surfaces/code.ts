import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import { errorResult } from '../gateway.ts'
import type { ProfileView, ToolEntry } from '../profiles/view.ts'
import { RESERVED_GLOBALS, runInSandbox, type SandboxResult } from '../sandbox/sandbox.ts'
import { describeTools, findTool, formatSearch, searchTools, serverOverview } from './discovery.ts'
import { getSchemaDefinition, normalizeNames, searchToolDefinition } from './meta.ts'
import { serverInstructions } from './passthrough.ts'
import type { SurfaceDeps, ToolSurface } from './types.ts'
import { namespaceDeclaration, toIdentifier } from './typescript.ts'

/** Above this size, declarations are left out of the tool description and found with search instead. */
export const MAX_INLINE_DECLARATIONS = 12_000

interface Namespaces {
  /** Global identifier → server. */
  servers: Map<string, string>
  /** Server → method identifier → tool entry. */
  methods: Map<string, Map<string, ToolEntry>>
  /** Server → global identifier. */
  identifiers: Map<string, string>
  declarations: string
}

const namespacesCache = new WeakMap<ProfileView, Namespaces>()

export function namespacesFor(view: ProfileView): Namespaces {
  const cached = namespacesCache.get(view)
  if (cached) return cached
  const servers = new Map<string, string>()
  const identifiers = new Map<string, string>()
  const methods = new Map<string, Map<string, ToolEntry>>()
  const declarations: string[] = []
  const byServer = new Map<string, ToolEntry[]>()
  for (const entry of view.tools) {
    const list = byServer.get(entry.server) ?? []
    list.push(entry)
    byServer.set(entry.server, list)
  }
  for (const [server, entries] of byServer) {
    let id = toIdentifier(server)
    while (RESERVED_GLOBALS.has(id) || servers.has(id)) id = `${id}_`
    servers.set(id, server)
    identifiers.set(server, id)
    const table = new Map<string, ToolEntry>()
    for (const entry of entries) {
      let method = toIdentifier(entry.tool)
      while (table.has(method)) method = `${method}_`
      table.set(method, entry)
    }
    methods.set(server, table)
    declarations.push(
      namespaceDeclaration(
        id,
        [...table].map(([method, e]) => ({ ...e.definition, name: method })),
      ),
    )
  }
  const result = { servers, methods, identifiers, declarations: declarations.join('\n\n') }
  namespacesCache.set(view, result)
  return result
}

function codeName(ns: Namespaces, entry: ToolEntry): string {
  const table = ns.methods.get(entry.server)
  const method = table ? [...table].find(([, e]) => e === entry)?.[0] : undefined
  return `${ns.identifiers.get(entry.server) ?? toIdentifier(entry.server)}.${method ?? toIdentifier(entry.tool)}`
}

export function executeToolDefinition(view: ProfileView): Tool {
  const ns = namespacesFor(view)
  const { timeoutMs, maxToolCalls } = view.profile.budgets
  const inline = ns.declarations.length <= MAX_INLINE_DECLARATIONS
  const example = [...ns.methods].flatMap(([, t]) => [...t.values()])[0]
  const exampleCall = example ? `await ${codeName(ns, example)}({ ... })` : 'await server.tool({ ... })'
  const intro =
    'Run JavaScript that uses your tools, to do in one step what would take many tool calls. ' +
    'Write an async arrow function in plain JavaScript (not TypeScript) and return the result. ' +
    `Each server is a global object whose methods call its tools and resolve to their results: \`${exampleCall}\`. ` +
    'Run independent calls in parallel with Promise.all. A failing tool throws an Error you can catch. ' +
    'console.log output is returned with the result. There is no network, file system, require or timers. ' +
    `Limits: ${Math.round(timeoutMs / 1000)} s and ${maxToolCalls} tool calls per run.`
  const tools = inline
    ? `\n\nAvailable:\n\`\`\`ts\n${ns.declarations}\n\`\`\``
    : `\n\nServers: ${serverOverview(view)}. Never guess method names: find tools with search_tools or \`await catalog.search("keywords")\`, and read their types with get_schema or \`await catalog.describe(["server.tool"])\` before using them.`
  return {
    name: 'execute',
    title: 'Run code with tools',
    description: intro + tools,
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description:
            'An async arrow function, e.g. async () => { const r = await server.tool({}); return r }',
        },
      },
      required: ['code'],
    },
  }
}

/** Turn an MCP tool result into the value code receives. Errors throw. */
export function unwrapResult(result: CallToolResult): unknown {
  const texts = (result.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => (c as { text: string }).text)
  if (result.isError) throw new Error(texts.join('\n') || 'The tool failed without a message.')
  if (result.structuredContent !== undefined) return result.structuredContent
  const content = result.content ?? []
  if (content.length && texts.length === content.length) {
    const joined = texts.join('\n')
    try {
      return JSON.parse(joined)
    } catch {
      return joined
    }
  }
  return content.map((c) => {
    if (c.type === 'text') return c.text
    if (c.type === 'image' || c.type === 'audio')
      return { type: c.type, mimeType: c.mimeType, note: 'binary data omitted' }
    if (c.type === 'resource') return { type: 'resource', uri: c.resource.uri }
    return { type: c.type }
  })
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n--- TRUNCATED: showing ${max} of ${text.length} characters. Return less data, e.g. pick fields or slice arrays. ---`
}

export function formatRun(run: SandboxResult, view: ProfileView, maxChars: number): CallToolResult {
  const logs = run.logs.length ? `Logs:\n${run.logs.join('\n')}\n\n` : ''
  if (run.ok) {
    const value =
      run.result === undefined
        ? 'undefined (return a value to see it here)'
        : JSON.stringify(run.result, null, 2)
    return { content: [{ type: 'text', text: truncate(`${logs}Result:\n${value}`, maxChars) }] }
  }
  const error = run.error!
  const hints: string[] = []
  if (error.kind === 'syntax')
    hints.push('Write an async arrow function in plain JavaScript, without TypeScript types.')
  if (error.kind === 'runtime' && /not defined|not a function|undefined/.test(error.message)) {
    hints.push(
      `Server globals: ${[...namespacesFor(view).servers.keys()].join(', ') || 'none'}. Use catalog.search() to find methods.`,
    )
  }
  if (error.kind === 'timeout' || error.kind === 'budget')
    hints.push('Do less per run, or split the work over several runs.')
  const text = `${error.kind} error: ${error.message}${hints.length ? `\n${hints.join('\n')}` : ''}${logs ? `\n\n${logs.trimEnd()}` : ''}`
  return { isError: true, content: [{ type: 'text', text: truncate(text, maxChars) }] }
}

/**
 * The model writes JavaScript that calls tools, and Switchboard runs it in
 * the sandbox. Every call from the code goes through the gateway, so the
 * profile's rules and the audit log apply exactly as for direct calls.
 */
export function codeSurface({ gateway }: SurfaceDeps): ToolSurface {
  return {
    kind: 'code',
    listTools(view) {
      const inline = namespacesFor(view).declarations.length <= MAX_INLINE_DECLARATIONS
      const execute = executeToolDefinition(view)
      return inline ? [execute] : [execute, searchToolDefinition(view), getSchemaDefinition]
    },
    async callTool(name, args = {}, view, ctx) {
      const ns = namespacesFor(view)
      const budgets = view.profile.budgets
      if (name === 'search_tools') {
        const query = typeof args.query === 'string' ? args.query : ''
        const found = searchTools(view, query, typeof args.limit === 'number' ? args.limit : 10).map((f) => {
          const entry = findTool(view, f.name)
          return entry ? { ...f, name: codeName(ns, entry) } : f
        })
        return { content: [{ type: 'text', text: formatSearch(query, found, view) }] }
      }
      if (name === 'get_schema') {
        const names = normalizeNames(args.names ?? args.name).map((n) => fromCodeName(ns, n))
        const { text, found } = describeTools(view, names, (e) => codeName(ns, e))
        return { content: [{ type: 'text', text }], isError: found === 0 }
      }
      if (name !== 'execute') return errorResult(`Unknown tool "${name}".`)
      if (typeof args.code !== 'string' || !args.code.trim()) {
        return errorResult('Pass "code": an async arrow function in plain JavaScript.')
      }

      const run = await runInSandbox(
        args.code,
        [...ns.servers.keys()],
        {
          async callTool(namespace, method, input, signal) {
            const server = ns.servers.get(namespace)
            const entry = server ? ns.methods.get(server)?.get(method) : undefined
            if (!entry) {
              const known = server ? [...(ns.methods.get(server)?.keys() ?? [])].slice(0, 30).join(', ') : ''
              throw new Error(
                `${namespace}.${method} is not a tool in this profile.${known ? ` ${namespace} has: ${known}.` : ''}`,
              )
            }
            const result = await gateway.call(entry.id, (input ?? {}) as Record<string, unknown>, {
              ...ctx,
              signal,
              via: 'code',
            })
            return unwrapResult(result)
          },
          helpers: {
            search: async ([query, limit]) =>
              searchTools(view, String(query ?? ''), typeof limit === 'number' ? limit : 10).map((f) => {
                const entry = findTool(view, f.name)
                return { ...f, name: entry ? codeName(ns, entry) : f.name }
              }),
            describe: async ([names]) =>
              describeTools(
                view,
                normalizeNames(names).map((n) => fromCodeName(ns, n)),
                (e) => codeName(ns, e),
              ).text,
          },
        },
        {
          timeoutMs: budgets.timeoutMs,
          memoryMb: budgets.memoryMb,
          maxToolCalls: budgets.maxToolCalls,
          maxSourceBytes: budgets.maxSourceBytes,
        },
        ctx.signal,
      )
      return formatRun(run, view, budgets.maxResultChars)
    },
    instructions(view) {
      const base =
        'Use the execute tool to run JavaScript that calls your tools; prefer one execute call over many separate steps.'
      const servers = serverInstructions(view)
      return servers ? `${base}\n\n${servers}` : base
    },
  }
}

/** Accept `ns.method` as written in code, and map it back to `server.tool`. */
function fromCodeName(ns: Namespaces, name: string): string {
  const dot = name.indexOf('.')
  if (dot < 0) return name
  const server = ns.servers.get(name.slice(0, dot))
  const entry = server ? ns.methods.get(server)?.get(name.slice(dot + 1)) : undefined
  return entry?.id ?? name
}
