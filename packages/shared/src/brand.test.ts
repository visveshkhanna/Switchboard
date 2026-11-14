import { describe, expect, it } from 'vitest'
import { brand, brandEnv } from './brand.ts'

describe('brandEnv', () => {
  it('reads prefixed variables and treats empty as unset', () => {
    const env = { [`${brand.envPrefix}PORT`]: '9000', [`${brand.envPrefix}HOME`]: '' }
    expect(brandEnv('PORT', env)).toBe('9000')
    expect(brandEnv('HOME', env)).toBeUndefined()
    expect(brandEnv('MISSING', env)).toBeUndefined()
  })
})
