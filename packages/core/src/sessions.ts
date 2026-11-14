import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { brand } from '@switchboard/shared'
import type { Gateway } from './gateway.ts'
import type { Logger } from './logger.ts'
import type { ProfileView } from './profiles/view.ts'
import { type ConcreteSurface, pickSurface, type ToolSurface } from './surfaces/types.ts'
import type { UpstreamManager } from './upstream/manager.ts'

/** How long tools/list waits for servers that have never been listed. */
const FIRST_LIST_WAIT_MS = 15_000
/** Sessions without a request for this long are closed. */
const SESSION_IDLE_MS = 6 * 60 * 60 * 1000

export interface SessionInfo {
  id: string
  profile: string
  via: string
  client?: { name: string; version: string }
  surface: ConcreteSurface
  createdAt: string
  lastSeenAt: string
}

export interface Session extends SessionInfo {
  transport: WebStandardStreamableHTTPServerTransport
  server: Server
  /** The tool names last sent to the client, to know when to notify. */
  toolsKey: string
  touch(): void
}

export interface SessionEvents {
  change: []
}

export interface SessionDeps {
  gateway: Gateway
  upstream: UpstreamManager
  surfaces: Record<ConcreteSurface, ToolSurface>
  log: Logger
  version: string
}

/** One MCP server object per client session, so each client gets its own profile view. */
export class SessionRegistry extends EventEmitter<SessionEvents> {
  #sessions = new Map<string, Session>()
  #sweeper: NodeJS.Timeout

  constructor(private readonly deps: SessionDeps) {
    super()
    this.#sweeper = setInterval(() => this.#sweep(), 60_000)
    this.#sweeper.unref()
  }

  get(id: string): Session | undefined {
    return this.#sessions.get(id)
  }

  list(): SessionInfo[] {
    return [...this.#sessions.values()].map(
      ({ id, profile, via, client, surface, createdAt, lastSeenAt }) => ({
        id,
        profile,
        via,
        client,
        surface,
        createdAt,
        lastSeenAt,
      }),
    )
  }

  surfaceFor(view: ProfileView): ToolSurface {
    return this.deps.surfaces[pickSurface(view)]
  }

  /** Create the transport and server for a new session. It is registered once initialize succeeds. */
  async create(profile: string, via: string): Promise<Session> {
    const { gateway, log } = this.deps
    // Servers never listed before are started now, so the first session gets
    // their tools and instructions. Later sessions are answered from the catalog.
    const view = await this.#viewWithCatalog(profile)
    const surface = this.surfaceFor(view)
    const server = new Server(
      { name: brand.name, title: `${brand.displayName} · ${profile}`, version: this.deps.version },
      {
        capabilities: { tools: { listChanged: true } },
        instructions: surface.instructions(view),
      },
    )
    const now = new Date().toISOString()
    const session: Session = {
      id: '',
      profile,
      via,
      surface: surface.kind,
      createdAt: now,
      lastSeenAt: now,
      server,
      toolsKey: '',
      touch() {
        session.lastSeenAt = new Date().toISOString()
      },
      transport: new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID,
        onsessioninitialized: (id) => {
          session.id = id
          const info = server.getClientVersion()
          if (info) session.client = { name: info.name, version: info.version }
          this.#sessions.set(id, session)
          log.info(`session ${id.slice(0, 8)} opened`, { profile, via, client: info?.name })
          this.emit('change')
        },
        onsessionclosed: (id) => this.#remove(id),
      }),
    }

    server.setRequestHandler(ListToolsRequestSchema, async () => {
      session.touch()
      const current = await this.#viewWithCatalog(profile)
      const currentSurface = this.surfaceFor(current)
      session.surface = currentSurface.kind
      const tools = currentSurface.listTools(current)
      session.toolsKey = toolsKey(tools)
      return { tools }
    })

    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      session.touch()
      const current = gateway.view(profile)
      return this.surfaceFor(current).callTool(request.params.name, request.params.arguments, current, {
        profile,
        session: session.id,
        client: session.client?.name,
        signal: extra.signal,
      })
    })

    server.onclose = () => {
      if (session.id) this.#remove(session.id)
    }
    await server.connect(session.transport)
    return session
  }

  /** Tell sessions whose tool list changed to list again. */
  notifyChanges(): void {
    for (const session of this.#sessions.values()) {
      let key: string
      try {
        const view = this.deps.gateway.view(session.profile)
        key = toolsKey(this.surfaceFor(view).listTools(view))
      } catch {
        // The profile was deleted: the next request will fail with a clear error.
        key = 'deleted'
      }
      if (key === session.toolsKey) continue
      session.toolsKey = key
      session.server.sendToolListChanged().catch(() => undefined)
    }
  }

  async closeAll(): Promise<void> {
    clearInterval(this.#sweeper)
    await Promise.all([...this.#sessions.values()].map((s) => s.transport.close().catch(() => undefined)))
    this.#sessions.clear()
  }

  async #viewWithCatalog(profile: string): Promise<ProfileView> {
    const view = this.deps.gateway.view(profile)
    const missing = view.servers.filter((s) => !view.tools.some((t) => t.server === s))
    if (missing.length) {
      const wait = this.deps.upstream.ensureCatalog(missing)
      await Promise.race([wait, new Promise((resolve) => setTimeout(resolve, FIRST_LIST_WAIT_MS).unref())])
      return this.deps.gateway.view(profile)
    }
    return view
  }

  #remove(id: string): void {
    if (!this.#sessions.delete(id)) return
    this.deps.log.info(`session ${id.slice(0, 8)} closed`)
    this.emit('change')
  }

  #sweep(): void {
    const cutoff = Date.now() - SESSION_IDLE_MS
    for (const session of this.#sessions.values()) {
      if (Date.parse(session.lastSeenAt) < cutoff) {
        void session.transport.close().catch(() => undefined)
        this.#remove(session.id)
      }
    }
  }
}

function toolsKey(tools: { name: string; description?: string }[]): string {
  return tools.map((t) => `${t.name}\u0000${t.description ?? ''}`).join('\u0001')
}
