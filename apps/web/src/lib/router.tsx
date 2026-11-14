import { type AnchorHTMLAttributes, type MouseEvent, useSyncExternalStore } from 'react'

const listeners = new Set<() => void>()
const notify = () => {
  for (const l of listeners) l()
}
window.addEventListener('popstate', notify)

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function navigate(to: string, { replace = false } = {}): void {
  if (to === location.pathname + location.search) return
  history[replace ? 'replaceState' : 'pushState'](null, '', to)
  window.scrollTo(0, 0)
  notify()
}

export function useLocation(): { path: string; query: URLSearchParams } {
  const href = useSyncExternalStore(subscribe, () => location.pathname + location.search)
  const url = new URL(href, location.origin)
  return { path: url.pathname.replace(/\/+$/, '') || '/', query: url.searchParams }
}

/** Match `/profiles/:name` style patterns; returns params or null. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/')
  const s = path.split('/')
  if (p.length !== s.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < p.length; i++) {
    const part = p[i]!
    if (part.startsWith(':')) params[part.slice(1)] = decodeURIComponent(s[i]!)
    else if (part !== s[i]) return null
  }
  return params
}

export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e)
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    navigate(to)
  }
  return <a href={to} onClick={handle} {...rest} />
}
