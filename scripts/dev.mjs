#!/usr/bin/env node
// Run Switchboard for development: the daemon from source, restarting when
// its code changes, and the web UI with hot reload, together.
//
//   pnpm dev
//
// State lives in .dev/home and the daemon listens on 17690, so a Switchboard
// you have installed (~/.switchboard, port 7690) is never touched. Set
// SWITCHBOARD_HOME or SWITCHBOARD_PORT to override.
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const env = {
  ...process.env,
  SWITCHBOARD_HOME: process.env.SWITCHBOARD_HOME || `${root}.dev/home`,
  SWITCHBOARD_PORT: process.env.SWITCHBOARD_PORT || '17690',
  FORCE_COLOR: '1',
}
mkdirSync(env.SWITCHBOARD_HOME, { recursive: true })

const tasks = [
  {
    name: 'daemon',
    color: 36,
    args: ['--filter', 'mcp-switchboard', 'exec', 'tsx', 'watch', 'src/cli.ts', 'up', '--no-open'],
  },
  { name: 'web', color: 35, args: ['--filter', '@switchboard/web', 'exec', 'vite', '--open'] },
]

console.log(
  `\nSwitchboard dev\n  state  ${env.SWITCHBOARD_HOME}\n  daemon http://127.0.0.1:${env.SWITCHBOARD_PORT}\n  web UI opens from Vite (hot reload)\n`,
)

const children = tasks.map(({ name, color, args }) => {
  // Each task gets its own process group, so stopping reaches tsx's and Vite's children too.
  const child = spawn('pnpm', args, {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    detached: process.platform !== 'win32',
  })
  const prefix = `\x1b[${color}m${name.padEnd(6)}\x1b[0m │ `
  const pipe = (stream, out) => {
    let buffer = ''
    stream.on('data', (chunk) => {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) out.write(`${prefix}${line}\n`)
    })
  }
  pipe(child.stdout, process.stdout)
  pipe(child.stderr, process.stderr)
  child.on('exit', (code) => {
    if (!stopping) {
      console.log(`${prefix}exited with code ${code}; stopping`)
      stop()
    }
  })
  return child
})

let stopping = false
function signal(child, name) {
  try {
    if (process.platform === 'win32') child.kill(name)
    else process.kill(-child.pid, name)
  } catch {}
}

function stop() {
  if (stopping) return
  stopping = true
  for (const child of children) signal(child, 'SIGINT')
  setTimeout(() => {
    for (const child of children) signal(child, 'SIGKILL')
    process.exit(0)
  }, 2500).unref()
  Promise.all(children.map((c) => new Promise((r) => (c.exitCode !== null ? r() : c.once('exit', r))))).then(
    () => process.exit(0),
  )
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
