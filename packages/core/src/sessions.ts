import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'
import { brand } from '@switchboard/shared'
import { errorResult, type Gateway } from './gateway.ts'
import type { Logger } from './logger.ts'
import type { ProfileView } from './profiles/view.ts'
import type { ResolvedVia, SeenClients } from './seen-clients.ts'
import { type ConcreteSurface, pickSurface, type ToolSurface } from './surfaces/types.ts'
import type { UpstreamManager } from './upstream/manager.ts'

/** How long tools/list waits for servers that have never been listed. */
const FIRST_LIST_WAIT_MS = 15_000
/** Sessions without a request for this long are closed. */
const SESSION_IDLE_MS = 6 * 60 * 60 * 1000

export interface SessionInfo {
  id: string
  /** null while the client waits for a profile to be assigned. */
  profile: string | null
  via: ResolvedVia
  client?: { name: string; version: string }
  surface: ConcreteSurface | null
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
  seen?: SeenClients
  /** The profile client rules and the default profile give a client name now. */
  resolve: (clientName: string | undefined) => { profile: string; via: 'client-rule' | 'default' } | undefined
  /** Where the user assigns profiles, for messages to waiting clients. */
  adminUrl: () => string
  log: Logger
  version: string
}

/**
 * One MCP server object per client session, so each client gets its own
 * profile view. Sessions whose profile came from client rules or the default
 * profile follow rule changes; sessions with no matching profile wait with
 * no tools until one is assigned.
 */
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

  #waitingMessage(name?: string): string {
    return (
      `${brand.displayName} has no profile for this client${name ? ` ("${name}")` : ''} yet, so it has no tools. ` +
      `Assign a profile at ${this.deps.adminUrl()}/clients and its tools appear without reconnecting.`
    )
  }

  /** Create the transport and server for a new session. It is registered once initialize succeeds. */
  async create(
    profile: string | null,
    via: ResolvedVia,
    clientName?: string,
    clientVersion?: string,
  ): Promise<Session> {
    const { gateway, log } = this.deps
    // Servers never listed before are started now, so the first session gets
    // their tools and instructions. Later sessions are answered from the catalog.
    const view = profile ? await this.#viewWithCatalog(profile) : undefined
    const surface = view ? this.surfaceFor(view) : undefined
    const server = new Server(
      {
        name: brand.name,
        title: `${brand.displayName}${profile ? ` · ${profile}` : ''}`,
        version: this.deps.version,
      },
      {
        capabilities: { tools: { listChanged: true } },
        instructions: view && surface ? surface.instructions(view) : this.#waitingMessage(clientName),
      },
    )
    const now = new Date().toISOString()
    const session: Session = {
      id: '',
      profile,
      via,
      client: clientName ? { name: clientName, version: clientVersion ?? '' } : undefined,
      surface: surface?.kind ?? null,
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
          this.#sessions.set(id, session)
          // Record the client now: some clients never send notifications/initialized.
          if (session.client) {
            this.deps.seen?.record(session.client.name, session.client.version, session.via, session.profile)
          }
          this.emit('change')
        },
        onsessionclosed: (id) => this.#remove(id),
      }),
    }

    server.setRequestHandler(ListToolsRequestSchema, async () => {
      session.touch()
      const tools = await this.#listTools(session, true)
      session.toolsKey = toolsKey(tools)
      return { tools }
    })

    server.setRequestHandler(CallToolRequestSchema, async (request, extra): Promise<CallToolResult> => {
      session.touch()
      if (!session.profile) return errorResult(this.#waitingMessage(session.client?.name))
      const current = gateway.view(session.profile)
      return this.surfaceFor(current).callTool(request.params.name, request.params.arguments, current, {
        profile: session.profile,
        session: session.id,
        client: session.client?.name,
        signal: extra.signal,
      })
    })

    server.oninitialized = () => {
      const info = server.getClientVersion()
      if (info) session.client = { name: info.name, version: info.version }
      if (session.client) {
        this.deps.seen?.record(session.client.name, session.client.version, session.via, session.profile)
      }
      log.info(`session ${session.id.slice(0, 8)} opened`, {
        profile: session.profile ?? '(waiting)',
        via: session.via,
        client: session.client?.name,
      })
      this.emit('change')
    }
    server.onclose = () => {
      if (session.id) this.#remove(session.id)
    }
    await server.connect(session.transport)
    return session
  }

  async #listTools(session: Session, waitForCatalog: boolean): Promise<Tool[]> {
    if (!session.profile) return []
    const view = waitForCatalog
      ? await this.#viewWithCatalog(session.profile)
      : this.deps.gateway.view(session.profile)
    const surface = this.surfaceFor(view)
    session.surface = surface.kind
    return surface.listTools(view)
  }

  /**
   * After a config or catalog change: move sessions whose profile came from
   * client rules or the default (or that were waiting) to what those give
   * now, and tell sessions whose tool list changed to list again.
   */
  notifyChanges(): void {
    let moved = false
    for (const session of this.#sessions.values()) {
      if (session.via === 'client-rule' || session.via === 'default' || session.via === 'unassigned') {
        const next = this.deps.resolve(session.client?.name)
        const profile = next?.profile ?? null
        const via: ResolvedVia = next?.via ?? 'unassigned'
        if (profile !== session.profile || via !== session.via) {
          this.deps.log.info(`session ${session.id.slice(0, 8)} moved to ${profile ?? '(waiting)'}`, {
            client: session.client?.name,
          })
          session.profile = profile
          session.via = via
          moved = true
          if (session.client)
            this.deps.seen?.record(session.client.name, session.client.version, via, profile)
        }
      }
      let key: string
      try {
        if (!session.profile) key = ''
        else {
          const view = this.deps.gateway.view(session.profile)
          const surface = this.surfaceFor(view)
          session.surface = surface.kind
          key = toolsKey(surface.listTools(view))
        }
      } catch {
        // The profile was deleted: the next request will fail with a clear error.
        key = 'deleted'
      }
      if (key === session.toolsKey) continue
      session.toolsKey = key
      session.server.sendToolListChanged().catch(() => undefined)
    }
    if (moved) this.emit('change')
  }

  /** Open sessions per client name, and how many of them wait for a profile. */
  countsByClient(): Map<string, { sessions: number; waiting: number }> {
    const counts = new Map<string, { sessions: number; waiting: number }>()
    for (const session of this.#sessions.values()) {
      const name = session.client?.name
      if (!name) continue
      const entry = counts.get(name) ?? { sessions: 0, waiting: 0 }
      entry.sessions++
      if (!session.profile) entry.waiting++
      counts.set(name, entry)
    }
    return counts
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
