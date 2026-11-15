import type { MiddlewareHandler } from 'hono'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

function hostname(hostHeader: string): string {
  if (hostHeader.startsWith('[')) return hostHeader.slice(0, hostHeader.indexOf(']') + 1)
  return hostHeader.split(':')[0]!.toLowerCase()
}

/**
 * DNS-rebinding protection: only answer requests addressed to a loopback
 * name, and only accept browser requests from our own origin. Clients that
 * are not browsers send no Origin header.
 */
export function loopbackGuard(extraHosts: string[] = []): MiddlewareHandler {
  const allowed = new Set([...LOOPBACK_HOSTS, ...extraHosts.map((h) => h.toLowerCase())])
  return async (c, next) => {
    // Platform health checks (Fly, Docker, load balancers) may use any Host.
    // /healthz only reveals that Switchboard is up, so it is exempt.
    if (c.req.method === 'GET' && c.req.path === '/healthz' && !c.req.header('origin')) return next()
    const host = c.req.header('host')
    if (!host || !allowed.has(hostname(host))) {
      return c.json({ error: `Host "${host ?? ''}" is not allowed.` }, 403)
    }
    const origin = c.req.header('origin')
    if (origin && origin !== 'null') {
      let originHost: string
      try {
        originHost = new URL(origin).host
      } catch {
        return c.json({ error: 'Invalid Origin header.' }, 403)
      }
      if (originHost.toLowerCase() !== host.toLowerCase()) {
        return c.json({ error: `Origin "${origin}" is not allowed.` }, 403)
      }
    }
    await next()
  }
}
