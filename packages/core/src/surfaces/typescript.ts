/**
 * Turns JSON Schema into compact TypeScript type text that models read well.
 * It favours readability over completeness: anything it cannot express
 * becomes `unknown`.
 */

type Schema = Record<string, unknown> | boolean

const RESERVED = new Set(
  'break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await'.split(
    ' ',
  ),
)

/** A valid JavaScript identifier for a server or tool name. */
export function toIdentifier(name: string): string {
  let id = name.replace(/[^A-Za-z0-9_$]/g, '_')
  if (/^[0-9]/.test(id)) id = `_${id}`
  if (RESERVED.has(id)) id = `${id}_`
  return id || '_'
}

const MAX_DEPTH = 8

function propertyKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key)
}

function comment(text: unknown, indent: string): string {
  if (typeof text !== 'string' || !text.trim()) return ''
  const clean = text.trim().replace(/\*\//g, '*\\/')
  const lines = clean.split(/\r?\n/)
  if (lines.length === 1) return `${indent}/** ${lines[0]} */\n`
  return `${indent}/**\n${lines.map((l) => `${indent} * ${l}`).join('\n')}\n${indent} */\n`
}

class Generator {
  constructor(private readonly root: Schema) {}

  resolveRef(ref: string): Schema | undefined {
    if (!ref.startsWith('#/')) return undefined
    let node: unknown = this.root
    for (const part of ref.slice(2).split('/')) {
      const key = part.replace(/~1/g, '/').replace(/~0/g, '~')
      if (!node || typeof node !== 'object') return undefined
      node = (node as Record<string, unknown>)[key]
    }
    return node as Schema | undefined
  }

  type(schema: Schema | undefined, depth: number, indent: string, seen: Set<string>): string {
    if (schema === undefined || schema === true) return 'unknown'
    if (schema === false) return 'never'
    if (depth > MAX_DEPTH) return 'unknown'
    const s = schema as Record<string, unknown>

    if (typeof s.$ref === 'string') {
      if (seen.has(s.$ref)) return 'unknown'
      const target = this.resolveRef(s.$ref)
      if (!target) return 'unknown'
      return this.type(target, depth + 1, indent, new Set([...seen, s.$ref]))
    }
    if ('const' in s) return JSON.stringify(s.const)
    if (Array.isArray(s.enum)) return s.enum.map((v) => JSON.stringify(v)).join(' | ') || 'never'

    const union = (s.anyOf ?? s.oneOf) as Schema[] | undefined
    if (Array.isArray(union)) {
      const parts = [...new Set(union.map((u) => this.type(u, depth + 1, indent, seen)))]
      return parts.length > 1 ? parts.map(wrap).join(' | ') : (parts[0] ?? 'unknown')
    }
    if (Array.isArray(s.allOf)) {
      const parts = (s.allOf as Schema[]).map((u) => this.type(u, depth + 1, indent, seen))
      return parts.map(wrap).join(' & ') || 'unknown'
    }

    const types = Array.isArray(s.type) ? (s.type as string[]) : typeof s.type === 'string' ? [s.type] : []
    if (!types.length) {
      if (s.properties || s.additionalProperties) types.push('object')
      else if (s.items) types.push('array')
    }
    if (!types.length) return 'unknown'
    const rendered = types.map((t) => this.single(t, s, depth, indent, seen))
    return rendered.length > 1 ? rendered.map(wrap).join(' | ') : rendered[0]!
  }

  single(type: string, s: Record<string, unknown>, depth: number, indent: string, seen: Set<string>): string {
    switch (type) {
      case 'string':
        return 'string'
      case 'number':
      case 'integer':
        return 'number'
      case 'boolean':
        return 'boolean'
      case 'null':
        return 'null'
      case 'array': {
        const items = s.items as Schema | Schema[] | undefined
        if (Array.isArray(items)) {
          return `[${items.map((i) => this.type(i, depth + 1, indent, seen)).join(', ')}]`
        }
        return `${wrap(this.type(items, depth + 1, indent, seen))}[]`
      }
      case 'object':
        return this.object(s, depth, indent, seen)
      default:
        return 'unknown'
    }
  }

  object(s: Record<string, unknown>, depth: number, indent: string, seen: Set<string>): string {
    const properties = (s.properties ?? {}) as Record<string, Schema>
    const required = new Set((s.required ?? []) as string[])
    const inner = `${indent}  `
    const lines: string[] = []
    for (const [key, prop] of Object.entries(properties)) {
      const description = typeof prop === 'object' ? prop.description : undefined
      const optional = required.has(key) ? '' : '?'
      lines.push(
        `${comment(description, inner)}${inner}${propertyKey(key)}${optional}: ${this.type(prop, depth + 1, inner, seen)};`,
      )
    }
    const extra = s.additionalProperties
    if (extra && extra !== false) {
      const value = extra === true ? 'unknown' : this.type(extra as Schema, depth + 1, inner, seen)
      if (!lines.length) return `Record<string, ${value}>`
      lines.push(`${inner}[key: string]: ${value === 'unknown' ? 'unknown' : `${value} | undefined`};`)
    }
    if (!lines.length) return '{}'
    return `{\n${lines.join('\n')}\n${indent}}`
  }
}

function wrap(type: string): string {
  return /[|&]/.test(type) && !type.startsWith('{') ? `(${type})` : type
}

export function schemaToTypeScript(schema: unknown, indent = ''): string {
  if (schema === undefined || schema === null) return 'unknown'
  const root = schema as Schema
  return new Generator(root).type(root, 0, indent, new Set())
}

export interface DeclarableTool {
  name: string
  description?: string
  inputSchema?: unknown
  outputSchema?: unknown
}

/** One method signature, with its description as JSDoc. */
export function toolSignature(
  tool: DeclarableTool,
  indent = '',
  displayName = toIdentifier(tool.name),
): string {
  const input = schemaToTypeScript(tool.inputSchema ?? { type: 'object' }, indent)
  const output = tool.outputSchema ? schemaToTypeScript(tool.outputSchema, indent) : 'unknown'
  const args = input === '{}' ? 'input?: {}' : `input: ${input}`
  return `${comment(tool.description, indent)}${indent}${displayName}(${args}): Promise<${output}>;`
}

/** `declare const server: { ...methods }` for one server's tools. */
export function namespaceDeclaration(server: string, tools: DeclarableTool[]): string {
  const methods = tools.map((t) => toolSignature(t, '  ')).join('\n')
  return `declare const ${toIdentifier(server)}: {\n${methods}\n};`
}
