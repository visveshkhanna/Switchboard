import { homedir } from 'node:os'
import { join } from 'node:path'
import { brand, brandEnv } from '@switchboard/shared'

export interface Paths {
  home: string
  config: string
  catalog: string
  secrets: string
  adminToken: string
  audit: string
  logs: string
  backups: string
  pid: string
  seenClients: string
}

/** Where Switchboard keeps its state: `SWITCHBOARD_HOME`, or `~/.switchboard`. */
export function resolvePaths(home = brandEnv('HOME') ?? join(homedir(), brand.stateDirName)): Paths {
  return {
    home,
    config: join(home, 'config.json'),
    catalog: join(home, 'catalog.json'),
    secrets: join(home, 'secrets.json'),
    adminToken: join(home, 'admin-token'),
    audit: join(home, 'audit.jsonl'),
    logs: join(home, 'logs'),
    backups: join(home, 'backups'),
    pid: join(home, 'daemon.json'),
    seenClients: join(home, 'seen-clients.json'),
  }
}
