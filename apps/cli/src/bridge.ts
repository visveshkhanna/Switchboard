import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'

/**
 * Forwards MCP messages between stdin/stdout and the daemon's HTTP endpoint,
 * for clients that can only start local commands. stdout carries protocol
 * messages only; everything else goes to stderr.
 */
export async function runBridge(url: string, headers: Record<string, string> = {}): Promise<void> {
  const stdio = new StdioServerTransport()
  const http = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } })

  let closing = false
  const close = async (code = 0) => {
    if (closing) return
    closing = true
    await Promise.allSettled([http.close(), stdio.close()])
    process.exit(code)
  }

  // Until initialize is answered there is no session id, so later messages wait.
  let initializing: { id: unknown; queue: JSONRPCMessage[] } | undefined
  const forward = (message: JSONRPCMessage) => {
    if (initializing) {
      initializing.queue.push(message)
      return
    }
    if ('method' in message && message.method === 'initialize' && 'id' in message) {
      initializing = { id: message.id, queue: [] }
    }
    http.send(message).catch((error: Error) => {
      process.stderr.write(`switchboard bridge: ${error.message}\n`)
      // Answer requests that could not be delivered so the client does not hang.
      if ('id' in message && 'method' in message) {
        void stdio.send({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32000, message: error.message },
        })
      }
      flush()
    })
  }
  const flush = () => {
    const queued = initializing?.queue ?? []
    initializing = undefined
    for (const message of queued) forward(message)
  }
  stdio.onmessage = forward

  http.onmessage = (message: JSONRPCMessage) => {
    // Later requests must carry the negotiated protocol version header.
    const result = (message as { result?: { protocolVersion?: unknown } }).result
    if (typeof result?.protocolVersion === 'string') http.setProtocolVersion(result.protocolVersion)
    void stdio.send(message)
    if (initializing && 'id' in message && message.id === initializing.id) flush()
  }
  stdio.onclose = () => void close(0)
  // The SDK's stdio transport does not watch for the client closing stdin.
  process.stdin.on('end', () => setTimeout(() => void close(0), 100))
  http.onerror = (error) => process.stderr.write(`switchboard bridge: ${error.message}\n`)
  process.on('SIGINT', () => void close(0))
  process.on('SIGTERM', () => void close(0))

  await http.start()
  await stdio.start()
}
