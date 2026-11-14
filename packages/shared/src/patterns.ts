/** Case-insensitive glob where `*` matches any run of characters. */
export function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`, 'i')
}

export function matchGlob(glob: string, value: string): boolean {
  return globToRegExp(glob).test(value)
}

/** Does `server.tool` match a pattern such as `server.*` or `git*.list_*`? */
export function matchToolPattern(pattern: string, server: string, tool: string): boolean {
  const dot = pattern.indexOf('.')
  if (dot < 0) return false
  return matchGlob(pattern.slice(0, dot), server) && matchGlob(pattern.slice(dot + 1), tool)
}
