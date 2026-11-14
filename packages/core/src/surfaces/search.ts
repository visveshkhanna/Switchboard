import type { ToolEntry } from '../profiles/view.ts'

/**
 * Offline tool search: BM25 over tool names, servers and descriptions, with
 * names weighted highest. Names are split on camelCase, snake_case, dots,
 * dashes and slashes, so "createIssue", "create_issue" and "create issue"
 * all match.
 */

export interface SearchHit {
  entry: ToolEntry
  score: number
}

const STOP_WORDS = new Set(
  'a an and are as at be by for from has have i in is it of on or that the this to with use using tool tools'.split(
    ' ',
  ),
)

export function tokenize(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t))
    .map(stem)
}

/** A very small stemmer: enough to match "issues" with "issue" and "listing" with "list". */
function stem(token: string): string {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`
  if (token.length > 5 && token.endsWith('ing')) return token.slice(0, -3)
  if (token.length > 3 && token.endsWith('es') && /(sh|ch|x|ss)es$/.test(token)) return token.slice(0, -2)
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1)
  return token
}

interface Doc {
  entry: ToolEntry
  fields: { tokens: string[]; weight: number }[]
  length: number
}

const K1 = 1.2
const B = 0.75

export class ToolIndex {
  #docs: Doc[]
  #df = new Map<string, number>()
  #avgLength: number

  constructor(entries: ToolEntry[]) {
    this.#docs = entries.map((entry) => {
      const fields = [
        { tokens: tokenize(entry.tool), weight: 3 },
        { tokens: tokenize(entry.name), weight: 1 },
        { tokens: tokenize(entry.server), weight: 2 },
        { tokens: tokenize(entry.definition.title ?? ''), weight: 2 },
        { tokens: tokenize(entry.definition.description ?? ''), weight: 1 },
      ]
      const length = fields.reduce((n, f) => n + f.tokens.length, 0)
      for (const term of new Set(fields.flatMap((f) => f.tokens))) {
        this.#df.set(term, (this.#df.get(term) ?? 0) + 1)
      }
      return { entry, fields, length }
    })
    this.#avgLength = this.#docs.reduce((n, d) => n + d.length, 0) / Math.max(1, this.#docs.length)
  }

  search(query: string, limit = 10): SearchHit[] {
    const terms = [...new Set(tokenize(query))]
    const raw = query.trim().toLowerCase()
    const n = this.#docs.length
    const hits: SearchHit[] = []
    for (const doc of this.#docs) {
      let score = 0
      let matched = 0
      for (const term of terms) {
        let tf = 0
        for (const field of doc.fields) {
          for (const token of field.tokens) {
            if (token === term) tf += field.weight
            else if (term.length >= 3 && token.startsWith(term)) tf += field.weight * 0.5
          }
        }
        if (!tf) continue
        matched++
        const df = this.#df.get(term) ?? 0
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5))
        score += (idf * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * doc.length) / (this.#avgLength || 1)))
      }
      if (!score) continue
      // Prefer tools that match every term, and exact name matches.
      if (terms.length > 1 && matched === terms.length) score *= 1.5
      const id = doc.entry.id.toLowerCase()
      if (raw === id || raw === doc.entry.tool.toLowerCase() || raw === doc.entry.name.toLowerCase())
        score *= 3
      hits.push({ entry: doc.entry, score })
    }
    return hits.sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id)).slice(0, limit)
  }
}
