import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { AuditEvent, AuditLog } from './audit.ts'
import type { ProfileView, ProfileViews, ToolEntry } from './profiles/view.ts'
import type { UpstreamManager } from './upstream/manager.ts'

export interface CallContext {
  profile: string
  session?: string
  client?: string
  via: AuditEvent['via']
  signal?: AbortSignal
  timeoutMs?: number
}

export function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] }
}

/**
 * The single path every tool call takes, whatever the surface. It checks the
 * tool against the profile *as it is now*, so a tool removed from a profile
 * cannot be called through a stale tool list, call_tool or code mode.
 */
export class Gateway {
  constructor(
    private readonly views: ProfileViews,
    private readonly upstream: UpstreamManager,
    private readonly audit: AuditLog,
  ) {}

  view(profile: string): ProfileView {
    return this.views.get(profile)
  }

  /** Look a tool up by exposed name or by `server.tool`. */
  find(profile: string, name: string): ToolEntry | undefined {
    const view = this.views.get(profile)
    return view.byName.get(name) ?? view.byId.get(name)
  }

  async call(
    name: string,
    args: Record<string, unknown> | undefined,
    ctx: CallContext,
  ): Promise<CallToolResult> {
    const started = performance.now()
    let entry = this.find(ctx.profile, name)
    if (!entry) {
      // An account that has not run yet has no tool list; start it and look again before refusing.
      const view = this.views.get(ctx.profile)
      await this.upstream.ensureCatalog(view.instances)
      entry = this.find(ctx.profile, name)
    }
    if (!entry) {
      const result = errorResult(`Tool "${name}" is not available in profile "${ctx.profile}".`)
      this.#record(name, ctx, started, false, 'not in profile')
      return result
    }
    const connection = this.upstream.get(entry.instance)
    if (!connection) return errorResult(`Server "${entry.instance}" is not configured.`)
    try {
      const result = await connection.callTool(entry.tool, args, {
        signal: ctx.signal,
        timeoutMs: ctx.timeoutMs,
      })
      this.#record(entry.id, ctx, started, !result.isError, result.isError ? firstText(result) : undefined)
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.#record(entry.id, ctx, started, false, message)
      return errorResult(`${entry.id} failed: ${message}`)
    }
  }

  #record(tool: string, ctx: CallContext, started: number, ok: boolean, error?: string): void {
    this.audit.record({
      ts: new Date().toISOString(),
      session: ctx.session,
      client: ctx.client,
      profile: ctx.profile,
      tool,
      via: ctx.via,
      durationMs: Math.round(performance.now() - started),
      ok,
      error: error?.slice(0, 500),
    })
  }
}

function firstText(result: CallToolResult): string | undefined {
  const item = result.content?.find((c) => c.type === 'text')
  return item && 'text' in item ? item.text : undefined
}
