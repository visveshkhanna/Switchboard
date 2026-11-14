import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { profileSchema } from '@switchboard/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConfigStore } from './store.ts'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'switchboard-config-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const waitFor = async (check: () => boolean) => {
  for (let i = 0; i < 400 && !check(); i++) await new Promise((r) => setTimeout(r, 20))
}

describe('ConfigStore', () => {
  it('creates the file and writes updates', async () => {
    const path = join(dir, 'config.json')
    const store = await ConfigStore.open(path)
    await store.update((c) => {
      c.profiles.work = profileSchema.parse({})
      return c
    })
    expect(JSON.parse(await readFile(path, 'utf8')).profiles.work.surface).toBe('auto')
    expect(store.revision).toBe(1)
  })

  it('rejects invalid updates and keeps the old config', async () => {
    const store = await ConfigStore.open(join(dir, 'config.json'))
    await expect(store.update((c) => ({ ...c, defaultProfile: 'missing' }))).rejects.toThrow(/does not exist/)
    expect(store.config.defaultProfile).toBeUndefined()
  })

  it('reloads valid edits made on disk and ignores invalid ones', async () => {
    const path = join(dir, 'config.json')
    const store = await ConfigStore.open(path)
    store.watch()
    const errors: Error[] = []
    store.on('error', (e) => errors.push(e))

    await writeFile(path, JSON.stringify({ profiles: { edited: {} } }))
    await waitFor(() => !!store.config.profiles.edited)
    expect(store.config.profiles.edited).toBeDefined()

    await writeFile(path, '{ not json')
    await waitFor(() => errors.length > 0)
    expect(errors).toHaveLength(1)
    expect(store.config.profiles.edited).toBeDefined()
    store.close()
  })
})
