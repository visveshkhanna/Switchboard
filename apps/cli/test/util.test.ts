import { describe, expect, it } from 'vitest'
import { safeBrowserUrl } from '../src/util.ts'

describe('safeBrowserUrl', () => {
  it('accepts only http and https URLs', () => {
    expect(safeBrowserUrl('https://auth.example.com/authorize?a=1&b=2')).toBe(
      'https://auth.example.com/authorize?a=1&b=2',
    )
    expect(safeBrowserUrl('http://127.0.0.1:7690/')).toBe('http://127.0.0.1:7690/')
    expect(safeBrowserUrl('file:///etc/passwd')).toBeUndefined()
    expect(safeBrowserUrl('javascript:alert(1)')).toBeUndefined()
    expect(safeBrowserUrl('calc.exe')).toBeUndefined()
    expect(safeBrowserUrl('" & calc.exe & "')).toBeUndefined()
  })
})
