import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import {
  type CallToolResult,
  CallToolResultSchema,
  type Tool,
  ToolListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { brand, type ServerConfig } from '@switchboard/shared'
import type { Catalog } from '../catalog.ts'
import type { Logger } from '../logger.ts'
import { resolveSecretList, resolveSecrets, type SecretBackend } from '../secrets.ts'
import { StoredOAuthProvider } from './oauth.ts'

export type ConnectionState = 'stopped' | 'starting' | 'ready' | 'error' | 'needs-auth'

export interface ConnectionStatus {
  name: string
  transport: ServerConfig['transport']
  enabled: boolean
  state: ConnectionState
  lastError?: string
  startedAt?: string
  lastUsedAt?: string
  inFlight: number
  toolCount?: number
  syncedAt?: string
  pid?: number
  /** Open this to sign in, when state is `needs-auth`. */
  authUrl?: string
}

export interface ConnectionDeps {
  catalog: Catalog
  secrets: SecretBackend
  log: Logger
  version: string
  /** The daemon's OAuth callback URL, once it is listening. */
  oauthRedirectUrl?: () => string | undefined
}

export interface CallOptions {
  signal?: AbortSignal
  /** Overrides the server's `callTimeoutSec`. */
  timeoutMs?: number
}

const MAX_STDERR_LINES = 200
const MAX_BACKOFF_MS = 30_000

export function configHash(config: ServerConfig): string {
  return createHash('sha256').update(JSON.stringify(config)).digest('hex').slice(0, 16)
}

export interface ConnectionEvents {
  status: [status: ConnectionStatus]
}

/**
 * One upstream MCP server. The connection is shared by every client session,
 * started on first use and stopped after `idleTimeoutSec` without calls.
 */
export class UpstreamConnection extends EventEmitter<ConnectionEvents> {
  readonly hash: string
  #client?: Client
  #transport?: Transport
  #connecting?: Promise<Client>
  #state: ConnectionState = 'stopped'
  #lastError?: string
  #failures = 0
  #retryAt = 0
  #inFlight = 0
  #idleTimer?: NodeJS.Timeout
  #startedAt?: Date
  #lastUsedAt?: Date
  #stopping = false
  #stderr: string[] = []
  #oauth?: StoredOAuthProvider
  #authUrl?: URL
  #pendingAuth?: StreamableHTTPClientTransport | SSEClientTransport

  constructor(
    readonly name: string,
    readonly config: ServerConfig,
    private readonly deps: ConnectionDeps,
  ) {
    super()
    this.hash = configHash(config)
  }

  get state(): ConnectionState {
    return this.#state
  }

  get stderr(): readonly string[] {
    return this.#stderr
  }

  status(): ConnectionStatus {
    const entry = this.deps.catalog.get(this.name)
    const pid =
      this.#transport instanceof StdioClientTransport ? (this.#transport.pid ?? undefined) : undefined
    return {
      name: this.name,
      transport: this.config.transport,
      enabled: this.config.enabled,
      state: this.#state,
      lastError: this.#lastError,
      startedAt: this.#startedAt?.toISOString(),
      lastUsedAt: this.#lastUsedAt?.toISOString(),
      inFlight: this.#inFlight,
      toolCount: entry?.tools.length,
      syncedAt: entry?.syncedAt,
      pid,
      authUrl: this.#state === 'needs-auth' ? this.#authUrl?.toString() : undefined,
    }
  }

  get oauthState(): string | undefined {
    return this.#pendingAuth ? this.#oauth?.state() : undefined
  }

  /** Complete a sign-in with the code from the OAuth callback, then connect. */
  async finishAuth(code: string): Promise<void> {
    const transport = this.#pendingAuth
    if (!transport) throw new Error(`No sign-in in progress for ${this.name}.`)
    await transport.finishAuth(code)
    this.#pendingAuth = undefined
    this.#authUrl = undefined
    this.#retryAt = 0
    this.#setState('stopped')
    await this.sync()
  }

  /** Forget stored OAuth tokens and client registration. */
  async signOut(): Promise<void> {
    await this.stop()
    await this.#oauthProvider().signOut()
  }

  #oauthProvider(): StoredOAuthProvider {
    this.#oauth ??= new StoredOAuthProvider(
      this.name,
      this.deps.secrets,
      () => this.deps.oauthRedirectUrl?.(),
      (url) => {
        this.#authUrl = url
      },
    )
    return this.#oauth
  }

  /** Connect if needed. Concurrent callers share one attempt. */
  async ready(): Promise<Client> {
    if (!this.config.enabled) throw new Error(`Server "${this.name}" is disabled.`)
    if (this.#client && this.#state === 'ready') return this.#client
    if (this.#connecting) return this.#connecting
    if (this.#state === 'needs-auth') {
      throw new Error(`Server "${this.name}" needs you to sign in: ${this.#authUrl ?? 'open the web UI'}`)
    }
    if (Date.now() < this.#retryAt) {
      const wait = Math.ceil((this.#retryAt - Date.now()) / 1000)
      throw new Error(`Server "${this.name}" failed to start (${this.#lastError}). Retrying in ${wait}s.`)
    }
    this.#connecting = this.#connect().finally(() => {
      this.#connecting = undefined
    })
    return this.#connecting
  }

  /** Connect and refresh the catalog, then let the idle timer stop it again. */
  async sync(): Promise<Tool[]> {
    this.#inFlight++
    try {
      await this.ready()
      return await this.refreshTools()
    } finally {
      this.#inFlight--
      this.#touch()
    }
  }

  async refreshTools(): Promise<Tool[]> {
    const client = await this.ready()
    const tools: Tool[] = []
    let cursor: string | undefined
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined)
      tools.push(...page.tools)
      cursor = page.nextCursor
    } while (cursor)
    this.deps.catalog.set(this.name, {
      tools,
      instructions: client.getInstructions(),
      serverVersion: client.getServerVersion(),
      syncedAt: new Date().toISOString(),
      configHash: this.hash,
    })
    this.#emitStatus()
    return tools
  }

  async callTool(tool: string, args: Record<string, unknown> | undefined, opts: CallOptions = {}) {
    this.#inFlight++
    this.#lastUsedAt = new Date()
    clearTimeout(this.#idleTimer)
    try {
      const client = await this.ready()
      const result = await client.request(
        { method: 'tools/call', params: { name: tool, arguments: args ?? {} } },
        CallToolResultSchema,
        {
          signal: opts.signal,
          timeout: opts.timeoutMs ?? this.config.callTimeoutSec * 1000,
          resetTimeoutOnProgress: true,
        },
      )
      return result as CallToolResult
    } finally {
      this.#inFlight--
      this.#touch()
    }
  }

  async stop(): Promise<void> {
    clearTimeout(this.#idleTimer)
    const client = this.#client
    this.#stopping = true
    this.#client = undefined
    this.#transport = undefined
    try {
      await client?.close()
    } catch {}
    this.#stopping = false
    if (this.#state !== 'error') this.#setState('stopped')
  }

  async #connect(): Promise<Client> {
    this.#setState('starting')
    const log = this.deps.log
    try {
      const client = await this.#open()
      this.#pendingAuth = undefined
      this.#client = client
      this.#failures = 0
      this.#retryAt = 0
      this.#lastError = undefined
      this.#startedAt = new Date()
      this.#setState('ready')
      log.info(`started ${this.name}`)
      this.#touch()
      return client
    } catch (error) {
      if (error instanceof UnauthorizedError && this.#authUrl) {
        this.#lastError = 'Sign-in required'
        this.#setState('needs-auth')
        log.info(`${this.name} needs sign-in: ${this.#authUrl}`)
        throw new Error(`Server "${this.name}" needs you to sign in: ${this.#authUrl}`)
      }
      this.#failures++
      this.#retryAt = Date.now() + Math.min(MAX_BACKOFF_MS, 500 * 2 ** this.#failures)
      this.#lastError = describeError(error, this.#stderr)
      this.#setState('error')
      log.warn(`could not start ${this.name}: ${this.#lastError}`)
      throw new Error(`Server "${this.name}" could not start: ${this.#lastError}`)
    }
  }

  async #open(): Promise<Client> {
    const config = this.config
    if (config.transport === 'stdio') {
      const transport = new StdioClientTransport({
        command: config.command,
        args: await resolveSecretList(config.args, this.deps.secrets),
        env: { ...inheritedEnv(), ...(await resolveSecrets(config.env, this.deps.secrets)) },
        cwd: config.cwd,
        stderr: 'pipe',
      })
      transport.stderr?.on('data', (chunk: Buffer) => this.#captureStderr(chunk.toString()))
      return this.#handshake(transport)
    }
    const url = new URL(config.url)
    const headers = await resolveSecrets(config.headers, this.deps.secrets)
    const requestInit = { headers }
    // Servers given an Authorization header use it; the rest may use OAuth.
    const hasAuth = Object.keys(headers).some((h) => h.toLowerCase() === 'authorization')
    const authProvider = hasAuth || !this.deps.oauthRedirectUrl ? undefined : this.#oauthProvider()
    const remember = <T extends StreamableHTTPClientTransport | SSEClientTransport>(t: T) => {
      this.#pendingAuth = t
      return t
    }
    if (config.transport === 'sse') {
      return this.#handshake(remember(new SSEClientTransport(url, { requestInit, authProvider })))
    }
    try {
      return await this.#handshake(
        remember(new StreamableHTTPClientTransport(url, { requestInit, authProvider })),
      )
    } catch (error) {
      const status = (error as { code?: number }).code
      // 4xx other than auth errors means the server may only speak the older SSE transport.
      if (error instanceof UnauthorizedError || status === 401 || status === 403) throw error
      this.deps.log.debug(`${this.name}: Streamable HTTP failed, trying SSE`)
      return this.#handshake(remember(new SSEClientTransport(url, { requestInit, authProvider })))
    }
  }

  async #handshake(transport: Transport): Promise<Client> {
    const client = new Client({ name: brand.name, version: this.deps.version }, { capabilities: {} })
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      this.deps.log.debug(`${this.name}: tools changed`)
      void this.refreshTools().catch((error) => this.deps.log.warn(`${this.name}: refresh failed: ${error}`))
    })
    client.onclose = () => {
      if (this.#client !== client) return
      this.#client = undefined
      this.#transport = undefined
      if (!this.#stopping) {
        this.deps.log.warn(`${this.name} exited`)
        this.#lastError = this.#stderr.at(-1) ?? 'the server closed the connection'
        this.#setState('stopped')
      }
    }
    this.#transport = transport
    try {
      await client.connect(transport, { timeout: 30_000 })
    } catch (error) {
      await client.close().catch(() => undefined)
      throw error
    }
    return client
  }

  #touch(): void {
    clearTimeout(this.#idleTimer)
    const idle = this.config.idleTimeoutSec
    if (!idle || this.#inFlight > 0 || !this.#client) return
    this.#idleTimer = setTimeout(() => {
      if (this.#inFlight > 0) return
      this.deps.log.info(`stopping idle ${this.name}`)
      void this.stop()
    }, idle * 1000)
    this.#idleTimer.unref()
  }

  #captureStderr(text: string): void {
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue
      this.#stderr.push(line)
      this.deps.log.debug(`${this.name}: ${line}`)
    }
    if (this.#stderr.length > MAX_STDERR_LINES) this.#stderr.splice(0, this.#stderr.length - MAX_STDERR_LINES)
  }

  #setState(state: ConnectionState): void {
    this.#state = state
    this.#emitStatus()
  }

  #emitStatus(): void {
    this.emit('status', this.status())
  }
}

/** The parent environment, so servers started with npx or uvx find PATH, HOME and proxies. */
function inheritedEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith(brand.envPrefix)) env[key] = value
  }
  return env
}

function describeError(error: unknown, stderr: string[]): string {
  const message = error instanceof Error ? error.message : String(error)
  const tail = stderr.slice(-3).join(' | ')
  return tail && !message.includes(tail) ? `${message} (stderr: ${tail})` : message
}
