import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
// Vite loads this file with Node's type stripping, which cannot run the whole
// shared package (it uses parameter properties); brand.ts alone is plain enough.
import { brand, brandEnv } from '../../packages/shared/src/brand.ts'

const port = Number(brandEnv('PORT') ?? brand.defaultPort)
const target = `http://127.0.0.1:${port}`

/**
 * In dev the daemon does not serve index.html, so put its admin token into
 * the page the same way the daemon does. Never applied to builds.
 */
function devToken(): Plugin {
  return {
    name: 'switchboard-dev-token',
    apply: 'serve',
    transformIndexHtml(html) {
      const home = brandEnv('HOME') ?? join(homedir(), brand.stateDirName)
      let token = ''
      try {
        token = readFileSync(join(home, 'admin-token'), 'utf8').trim()
      } catch {
        console.warn(`[web] no admin token in ${home}; start the daemon first`)
      }
      return html.replace('</head>', `<meta name="${brand.name}-token" content="${token}"></head>`)
    },
  }
}

// The daemon rejects requests whose Origin differs from its Host, so drop the
// dev server's Origin when proxying.
const proxy = {
  target,
  changeOrigin: true,
  configure: (p: {
    on(event: 'proxyReq', fn: (req: { removeHeader(name: string): void }) => void): void
  }) => {
    p.on('proxyReq', (req) => req.removeHeader('origin'))
  },
}

export default defineConfig({
  plugins: [react(), tailwindcss(), devToken()],
  server: {
    proxy: { '/api': proxy, '/p': proxy, '/mcp': proxy, '/healthz': proxy },
  },
  build: { outDir: 'dist', emptyOutDir: true },
})
