/**
 * A client id from an MCP client name: lowercase letters, digits, "-" and
 * "_", at most 48 characters. Linear time, whatever the input.
 */
export function clientId(name: string): string {
  let id = ''
  let dash = false
  for (const ch of name.slice(0, 200).toLowerCase()) {
    if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || (ch === '_' && id)) {
      id += ch
      dash = false
    } else if (!dash && id) {
      id += '-'
      dash = true
    }
    if (id.length >= 48) break
  }
  id = id.replace(/-$/, '')
  return id || 'unknown'
}

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
