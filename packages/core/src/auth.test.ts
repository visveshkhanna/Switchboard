import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AdminPassword } from './auth.ts'
import { trimTrailingSlashes } from './daemon.ts'

describe('AdminPassword', () => {
  it('verifies a password from the environment without keeping it in plain text', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sb-pw-'))
    const password = await AdminPassword.open(join(dir, 'admin.json'), 'from the environment')
    expect(password.isSet).toBe(true)
    expect(await password.verify('from the environment')).toBe(true)
    expect(await password.verify('something else')).toBe(false)
    expect(JSON.stringify(password)).not.toContain('from the environment')
  })

  it('stores only an scrypt hash', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sb-pw-'))
    const path = join(dir, 'admin.json')
    await (await AdminPassword.open(path)).set('stored password 123')
    const file = await readFile(path, 'utf8')
    expect(file).not.toContain('stored password')
    expect(JSON.parse(file)).toMatchObject({ algorithm: 'scrypt' })
    expect(await (await AdminPassword.open(path)).verify('stored password 123')).toBe(true)
  })
})

describe('trimTrailingSlashes', () => {
  it('trims in linear time', () => {
    expect(trimTrailingSlashes('https://a.example//')).toBe('https://a.example')
    expect(trimTrailingSlashes(undefined)).toBeUndefined()
    const started = performance.now()
    expect(trimTrailingSlashes(`x${'/'.repeat(200_000)}y`)).toBe(`x${'/'.repeat(200_000)}y`)
    expect(performance.now() - started).toBeLessThan(100)
  })
})
