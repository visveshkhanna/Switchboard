import { useSyncExternalStore } from 'react'

export type ThemePref = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

const KEY = 'switchboard.theme'
const listeners = new Set<() => void>()
const media = window.matchMedia('(prefers-color-scheme: dark)')

function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

let pref: ThemePref = read()

function resolve(p: ThemePref): ResolvedTheme {
  return p === 'system' ? (media.matches ? 'dark' : 'light') : p
}

/** Put the `dark` class on <html> (shadcn's dark mode). Safe to call before React renders. */
export function applyTheme(): void {
  document.documentElement.classList.toggle('dark', resolve(pref) === 'dark')
}

function notify() {
  applyTheme()
  for (const l of listeners) l()
}

// Follow the OS while the preference is "system".
media.addEventListener('change', () => {
  if (pref === 'system') notify()
})

export function setTheme(next: ThemePref): void {
  pref = next
  try {
    if (next === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, next)
  } catch {
    // Storage can be unavailable (private mode); the choice still applies to this tab.
  }
  notify()
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useTheme(): {
  theme: ThemePref
  resolved: ResolvedTheme
  setTheme: (p: ThemePref) => void
} {
  const theme = useSyncExternalStore(subscribe, () => pref)
  const resolved = useSyncExternalStore(subscribe, () => resolve(pref))
  return { theme, resolved, setTheme }
}
