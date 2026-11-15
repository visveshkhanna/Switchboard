import { describe, expect, it } from 'vitest'
import { type ConfigInput, configSchema, parseConfig } from './config.ts'
import { instanceFor, parseInstanceId, serverInstances } from './instances.ts'

const server = { transport: 'stdio' as const, command: 'gh-mcp', env: { LOG: 'info' } }
const config = (input: ConfigInput) => configSchema.parse(input)

describe('server instances', () => {
  it('runs one instance per account, merging the account over the server', () => {
    const c = config({
      servers: { github: server },
      profiles: {
        work: { servers: ['github'], credentials: { github: { env: { TOKEN: 'secret://work' } } } },
        personal: { servers: ['github'], credentials: { github: { env: { TOKEN: 'secret://me' } } } },
      },
    })
    const instances = serverInstances(c)
    expect(instances.map((i) => i.id)).toEqual(['github.work', 'github.personal'])
    expect(instances[0]!.config).toMatchObject({ env: { LOG: 'info', TOKEN: 'secret://work' } })
    expect(instanceFor(c, 'work', 'github')).toBe('github.work')
  })

  it('keeps the default instance for profiles without their own account', () => {
    const c = config({
      servers: { github: server },
      profiles: {
        work: { servers: ['github'], credentials: { github: { env: { TOKEN: 'x' } } } },
        oss: { servers: ['github'] },
      },
    })
    expect(serverInstances(c).map((i) => [i.id, i.profiles])).toEqual([
      ['github', ['oss']],
      ['github.work', ['work']],
    ])
    expect(instanceFor(c, 'oss', 'github')).toBe('github')
  })

  it('shares a named account between profiles', () => {
    const shared = { account: 'acme', env: { TOKEN: 'secret://acme' } }
    const c = config({
      servers: { github: server },
      profiles: {
        a: { servers: ['github'], credentials: { github: shared } },
        b: { servers: ['github'], credentials: { github: shared } },
      },
    })
    expect(serverInstances(c).map((i) => [i.id, i.profiles])).toEqual([['github.acme', ['a', 'b']]])
  })

  it('keeps a default instance for a server no profile uses', () => {
    expect(serverInstances(config({ servers: { github: server } })).map((i) => i.id)).toEqual(['github'])
  })

  it('merges headers for HTTP servers', () => {
    const c = config({
      servers: { linear: { transport: 'http', url: 'https://mcp.linear.app/mcp', headers: { A: '1' } } },
      profiles: {
        work: { servers: ['linear'], credentials: { linear: { headers: { Authorization: 'Bearer x' } } } },
      },
    })
    expect(serverInstances(c)[0]!.config).toMatchObject({ headers: { A: '1', Authorization: 'Bearer x' } })
  })

  it('rejects two profiles giving one account different credentials', () => {
    expect(() =>
      parseConfig({
        servers: { github: server },
        profiles: {
          a: { servers: ['github'], credentials: { github: { account: 'acme', env: { TOKEN: '1' } } } },
          b: { servers: ['github'], credentials: { github: { account: 'acme', env: { TOKEN: '2' } } } },
        },
      }),
    ).toThrow(/both use account "github.acme"/)
  })

  it('rejects credentials for an unknown server', () => {
    expect(() => parseConfig({ profiles: { a: { credentials: { nope: { env: { A: '1' } } } } } })).toThrow(
      /unknown server "nope"/,
    )
  })

  it('splits instance ids', () => {
    expect(parseInstanceId('github')).toEqual({ server: 'github', account: null })
    expect(parseInstanceId('github.work')).toEqual({ server: 'github', account: 'work' })
  })
})
