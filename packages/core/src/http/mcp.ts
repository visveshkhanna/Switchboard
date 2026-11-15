import { brand, type Config, slugSchema } from '@switchboard/shared'
import type { Context } from 'hono'
import type { Logger } from '../logger.ts'
import { connectionClientId, resolveProfile } from '../profiles/resolve.ts'
import type { SessionRegistry } from '../sessions.ts'

interface JsonRpcMessage {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: { clientInfo?: { name?: string; version?: string } }
}

function rpcError(status: number, message: string, id: JsonRpcMessage['id'] = null, code = -32000): Response {
  return Response.json({ jsonrpc: '2.0', id, error: { code, message } }, { status })
}

/**
 * Handles /p/:profile/mcp and /mcp. A request without a session must be an
 * initialize request: that is when the profile is chosen, from the path, the
 * header or the client's name. Later requests are routed by session id.
 */
export function mcpHandler(deps: {
  sessions: SessionRegistry
  config: () => Config
  log: Logger
  /** Checks the Authorization header; an API key names the client. */
  authorize?: (header: string | undefined) => { ok: true; clientId?: string } | { ok: false; message: string }
}) {
  return async (c: Context): Promise<Response> => {
    const auth = deps.authorize?.(c.req.header('authorization')) ?? { ok: true }
    if (!auth.ok) {
      return Response.json(
        { jsonrpc: '2.0', id: null, error: { code: -32001, message: auth.message } },
        { status: 401, headers: { 'www-authenticate': 'Bearer realm="switchboard"' } },
      )
    }
    const keyClient = auth.clientId
    const pathProfile = c.req.param('profile')
    const pathClient = c.req.param('client')
    if (keyClient && pathClient && pathClient !== keyClient) {
      return rpcError(403, `This API key belongs to client "${keyClient}", not "${pathClient}".`)
    }
    if (pathClient && !slugSchema.safeParse(pathClient).success) {
      return rpcError(
        400,
        `"${pathClient}" is not a valid client id: use lowercase letters, digits, "-" and "_".`,
      )
    }
    const sessionId = c.req.header('mcp-session-id')

    if (sessionId) {
      const session = deps.sessions.get(sessionId)
      if (!session) return rpcError(404, 'Session not found. Reconnect to start a new session.', null, -32001)
      if (keyClient && keyClient !== session.clientId) {
        return rpcError(403, `This session belongs to client "${session.clientId}", not to this API key.`)
      }
      if (pathClient && pathClient !== session.clientId) {
        return rpcError(400, `This session belongs to client "${session.clientId}", not "${pathClient}".`)
      }
      if (pathProfile && pathProfile !== session.profile) {
        return rpcError(400, `This session belongs to profile "${session.profile}", not "${pathProfile}".`)
      }
      return session.transport.handleRequest(c.req.raw)
    }

    if (c.req.method !== 'POST') {
      return rpcError(400, 'Missing mcp-session-id header. Send an initialize request first.')
    }

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return rpcError(400, 'Request body is not valid JSON.', null, -32700)
    }
    const messages = (Array.isArray(body) ? body : [body]) as JsonRpcMessage[]
    const init = messages.find((m) => m?.method === 'initialize')
    if (!init) return rpcError(400, 'Missing mcp-session-id header. Send an initialize request first.')

    const resolution = resolveProfile(
      {
        path: pathProfile,
        header: c.req.header(brand.profileHeader),
        clientId: keyClient ?? pathClient,
        clientName: init.params?.clientInfo?.name,
      },
      deps.config(),
    )
    const clientInfo = init.params?.clientInfo
    if (!resolution.ok && resolution.reason === 'unknown-profile') {
      deps.log.warn(resolution.message)
      return rpcError(400, resolution.message, init.id ?? null, -32602)
    }
    // A client nothing assigns a profile to is let in with no tools, and
    // shown in the web UI so the user can pick its profile.
    const id = connectionClientId({ clientId: keyClient ?? pathClient, clientName: clientInfo?.name })
    const session = resolution.ok
      ? await deps.sessions.create(
          resolution.profile,
          resolution.via,
          id,
          clientInfo?.name,
          clientInfo?.version,
        )
      : await deps.sessions.create(
          null,
          resolution.reason === 'disabled' ? 'disabled' : 'unassigned',
          id,
          clientInfo?.name,
          clientInfo?.version,
        )
    if (!resolution.ok) deps.log.info(`${id ?? 'a client'} has no profile: ${resolution.reason}`)
    return session.transport.handleRequest(c.req.raw, { parsedBody: body })
  }
}
