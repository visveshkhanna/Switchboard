import { cpSync, existsSync, readFileSync } from 'node:fs'
import { defineConfig } from 'tsup'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
  dependencies?: Record<string, string>
}

export default defineConfig({
  entry: { cli: 'src/cli.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node24',
  clean: true,
  sourcemap: true,
  // Workspace packages are bundled in; real dependencies stay external.
  noExternal: [/^@switchboard\//],
  external: Object.keys(pkg.dependencies ?? {}),
  define: { __SWITCHBOARD_VERSION__: JSON.stringify(process.env.SWITCHBOARD_VERSION ?? pkg.version) },
  banner: { js: '#!/usr/bin/env node' },
  // The daemon serves the web UI from dist/web.
  onSuccess: async () => {
    const web = new URL('../web/dist', import.meta.url)
    if (existsSync(web)) cpSync(web, new URL('./dist/web', import.meta.url), { recursive: true })
    else console.warn('apps/web/dist is missing: build @switchboard/web first')
  },
})
