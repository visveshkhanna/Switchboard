/**
 * Every user-visible name and default lives here. Code must not hard-code
 * "switchboard", "SWITCHBOARD_" or "~/.switchboard" anywhere else.
 */
export const brand = {
  name: 'switchboard',
  displayName: 'Switchboard',
  /** The npm package that ships the CLI and daemon. */
  packageName: 'mcp-switchboard',
  envPrefix: 'SWITCHBOARD_',
  stateDirName: '.switchboard',
  defaultPort: 7690,
  defaultHost: '127.0.0.1',
  profileHeader: 'x-switchboard-profile',
  docsUrl: 'https://switchboard.visvesh.dev',
  repoUrl: 'https://github.com/visveshkhanna/Switchboard',
} as const

/** Read `SWITCHBOARD_<key>` from an environment. */
export function brandEnv(key: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env[`${brand.envPrefix}${key}`]
  return value === '' ? undefined : value
}
