import { describe, expect, it } from 'vitest'
import { namespaceDeclaration, schemaToTypeScript, toIdentifier } from './typescript.ts'

describe('schemaToTypeScript', () => {
  it('renders objects with required and optional properties and descriptions', () => {
    const ts = schemaToTypeScript({
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Issue title' },
        labels: { type: 'array', items: { type: 'string' } },
        state: { enum: ['open', 'closed'] },
        'weird-key': { type: ['integer', 'null'] },
      },
      required: ['title'],
    })
    expect(ts).toBe(
      [
        '{',
        '  /** Issue title */',
        '  title: string;',
        '  labels?: string[];',
        '  state?: "open" | "closed";',
        '  "weird-key"?: number | null;',
        '}',
      ].join('\n'),
    )
  })

  it('resolves local refs and stops on cycles', () => {
    const ts = schemaToTypeScript({
      $defs: { node: { type: 'object', properties: { child: { $ref: '#/$defs/node' } } } },
      $ref: '#/$defs/node',
    })
    expect(ts).toBe('{\n  child?: unknown;\n}')
  })

  it('handles unions, intersections, records and tuples', () => {
    expect(
      schemaToTypeScript({ anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' } }] }),
    ).toBe('string | number[]')
    expect(schemaToTypeScript({ type: 'object', additionalProperties: { type: 'string' } })).toBe(
      'Record<string, string>',
    )
    expect(schemaToTypeScript({ type: 'array', items: [{ type: 'string' }, { type: 'number' }] })).toBe(
      '[string, number]',
    )
    expect(
      schemaToTypeScript({ type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'null' }] } }),
    ).toBe('(string | null)[]')
  })
})

describe('namespaceDeclaration', () => {
  it('declares one method per tool', () => {
    const text = namespaceDeclaration('my-server', [
      {
        name: 'delete',
        description: 'Remove it',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      },
      { name: 'ping', inputSchema: { type: 'object' } },
    ])
    expect(text).toContain('declare const my_server: {')
    expect(text).toContain('/** Remove it */')
    expect(text).toContain('delete_(input: {\n    id: string;\n  }): Promise<unknown>;')
    expect(text).toContain('ping(input?: {}): Promise<unknown>;')
  })

  it('makes identifiers valid', () => {
    expect(toIdentifier('2fa')).toBe('_2fa')
    expect(toIdentifier('a.b-c')).toBe('a_b_c')
  })
})
