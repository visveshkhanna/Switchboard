import { readFile } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { Hono } from 'hono'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
}

/**
 * Serves the built web UI. The admin token is put into index.html, which only
 * pages on this origin can read: the loopback guard blocks other hosts, and
 * browsers do not let other origins read the response.
 */
export function webUi(root: string, adminToken: string): Hono {
  const web = new Hono()
  let indexHtml: string | undefined

  const index = async () => {
    indexHtml ??= (await readFile(join(root, 'index.html'), 'utf8')).replace(
      '</head>',
      `<meta name="switchboard-token" content="${adminToken}"></head>`,
    )
    return indexHtml
  }

  web.get('*', async (c) => {
    const path = normalize(decodeURIComponent(c.req.path)).replace(/^([/\\])+/, '')
    const file = join(root, path)
    if (path && (file === root || file.startsWith(root + sep)) && extname(path)) {
      try {
        const body = await readFile(file)
        const immutable = path.startsWith('assets/')
        return c.body(body, 200, {
          'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
          'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
        })
      } catch {
        return c.notFound()
      }
    }
    // Client-side routes all serve the app.
    return c.html(await index(), 200, {
      'cache-control': 'no-store',
      'content-security-policy':
        "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
    })
  })
  return web
}
