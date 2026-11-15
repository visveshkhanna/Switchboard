import { brand } from '@switchboard/shared'
import { type Context, Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { z } from 'zod'
import { RateLimiter } from '../auth.ts'
import type { Daemon } from '../daemon.ts'

export const SESSION_COOKIE = `${brand.name}_session`
/** Sent by the web UI on every request; a cross-site form cannot set it. */
export const CSRF_HEADER = `x-${brand.name}-csrf`

/** Is this request from a logged-in web UI session? Mutations also need the CSRF header. */
export function hasAdminSession(daemon: Daemon, c: Context): boolean {
  if (!daemon.adminSessions.verify(getCookie(c, SESSION_COOKIE))) return false
  return c.req.method === 'GET' || c.req.method === 'HEAD' || c.req.header(CSRF_HEADER) === '1'
}

/**
 * Login for the web UI when Switchboard is hosted. Locally the page carries
 * the admin token and never needs these.
 */
export function authRoutes(daemon: Daemon): Hono {
  const auth = new Hono()
  const attempts = new RateLimiter(10, 10 * 60_000)
  const everyone = new RateLimiter(100, 10 * 60_000)
  const secure = () => daemon.baseUrl.startsWith('https://')

  auth.get('/session', (c) =>
    c.json({
      remote: daemon.remote,
      authenticated: daemon.adminSessions.verify(getCookie(c, SESSION_COOKIE)),
      passwordSet: daemon.adminPassword.isSet,
    }),
  )

  auth.post('/login', async (c) => {
    // The socket's address, not X-Forwarded-For, which any client can set. Behind a proxy
    // every request shares the proxy's address, so the global limit is the backstop.
    const ip =
      (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket
        ?.remoteAddress ?? 'unknown'
    if (!attempts.take(ip) || !everyone.take('all')) {
      return c.json({ error: 'Too many attempts. Try again in a few minutes.' }, 429)
    }
    const parsed = z
      .object({ password: z.string().min(1).max(1024) })
      .safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success || !(await daemon.adminPassword.verify(parsed.data.password))) {
      return c.json({ error: 'Wrong password.' }, 401)
    }
    setCookie(c, SESSION_COOKIE, daemon.adminSessions.create(), {
      httpOnly: true,
      secure: secure(),
      sameSite: 'Strict',
      path: '/',
      maxAge: 12 * 60 * 60,
    })
    return c.json({ ok: true })
  })

  auth.post('/logout', (c) => {
    daemon.adminSessions.remove(getCookie(c, SESSION_COOKIE))
    deleteCookie(c, SESSION_COOKIE, { path: '/' })
    return c.json({ ok: true })
  })

  return auth
}
