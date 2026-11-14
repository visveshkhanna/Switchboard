// A small MCP server for tests. Usage: node test-server.mjs <name> [--http <port>]
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const name = process.argv[2] ?? 'test'
const server = new McpServer(
  { name: `${name}-server`, version: '1.0.0' },
  { instructions: `Instructions for ${name}.` },
)

server.registerTool(
  'echo',
  { description: `Echo text back (${name})`, inputSchema: { text: z.string() } },
  async ({ text }) => ({ content: [{ type: 'text', text: `${name}:${text}` }] }),
)

server.registerTool(
  'add',
  { description: 'Add two numbers', inputSchema: { a: z.number(), b: z.number() } },
  async ({ a, b }) => ({
    content: [{ type: 'text', text: String(a + b) }],
    structuredContent: { sum: a + b },
  }),
)

server.registerTool('fail', { description: 'Always fails' }, async () => ({
  isError: true,
  content: [{ type: 'text', text: 'it failed' }],
}))

server.registerTool('pid', { description: 'Process id of this server' }, async () => ({
  content: [{ type: 'text', text: String(process.pid) }],
}))

server.registerTool(
  'sleep',
  { description: 'Wait, then answer', inputSchema: { ms: z.number() } },
  async ({ ms }) => {
    await new Promise((r) => setTimeout(r, ms))
    return { content: [{ type: 'text', text: 'done' }] }
  },
)

let added = 0
server.registerTool('grow', { description: 'Register one more tool' }, async () => {
  added++
  server.registerTool(`extra_${added}`, { description: `Extra tool ${added}` }, async () => ({
    content: [{ type: 'text', text: `extra ${added}` }],
  }))
  return { content: [{ type: 'text', text: `added extra_${added}` }] }
})

await server.connect(new StdioServerTransport())
process.stderr.write(`${name} ready\n`)
