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

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      authorization: `Bearer ${adminToken}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let data: unknown
  try {
    data = text ? JSON.parse(text) : undefined
  } catch {
    data = text
  }
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; problems?: string[] }
    throw new ApiError(d.error ?? `${method} ${path} failed (${res.status})`, res.status, d.problems ?? [])
  }
  return data as T
}

export const get = <T>(path: string) => api<T>('GET', path)
export const put = <T>(path: string, body: unknown) => api<T>('PUT', path, body)
export const post = <T>(path: string, body?: unknown) => api<T>('POST', path, body)
export const del = <T>(path: string) => api<T>('DELETE', path)

export const enc = encodeURIComponent

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
