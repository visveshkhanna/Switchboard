import { brand } from '@switchboard/shared'

export const adminToken =
  document.querySelector<HTMLMetaElement>(`meta[name="${brand.name}-token"]`)?.content ?? ''

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly problems: string[] = [],
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** Locally the page carries a token; hosted, an HttpOnly session cookie authenticates instead. */
export const cookieSession = !adminToken

const unauthorizedListeners = new Set<() => void>()
/** Called when a cookie session stops being accepted (expired or logged out elsewhere). */
export function onUnauthorized(listener: () => void): () => void {
  unauthorizedListeners.add(listener)
  return () => unauthorizedListeners.delete(listener)
}

async function request(url: string, method: string, body?: unknown): Promise<Response> {
  return fetch(url, {
    method,
    credentials: 'same-origin',
    headers: {
      // Proves the request comes from this page; a cross-site form cannot set it.
      [`x-${brand.name}-csrf`]: '1',
      ...(adminToken ? { authorization: `Bearer ${adminToken}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function parse<T>(res: Response, label: string): Promise<T> {
  const text = await res.text()
  let data: unknown
  try {
    data = text ? JSON.parse(text) : undefined
  } catch {
    data = text
  }
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; problems?: string[] }
    throw new ApiError(d.error ?? `${label} failed (${res.status})`, res.status, d.problems ?? [])
  }
  return data as T
}

/** The login endpoints, outside /api. */
export const auth = {
  session: async () =>
    parse<{ remote: boolean; authenticated: boolean; passwordSet: boolean }>(
      await request('/auth/session', 'GET'),
      'GET /auth/session',
    ),
  login: async (password: string) =>
    parse<{ ok: true }>(await request('/auth/login', 'POST', { password }), 'Sign in'),
  logout: async () => parse<{ ok: true }>(await request('/auth/logout', 'POST', {}), 'Log out'),
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await request(`/api${path}`, method, body)
  if (res.status === 401 && cookieSession) for (const l of unauthorizedListeners) l()
  return parse<T>(res, `${method} ${path}`)
}

export const get = <T>(path: string) => api<T>('GET', path)
export const put = <T>(path: string, body: unknown) => api<T>('PUT', path, body)
export const post = <T>(path: string, body?: unknown) => api<T>('POST', path, body)
export const del = <T>(path: string) => api<T>('DELETE', path)

export const enc = encodeURIComponent

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
