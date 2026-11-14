# Agent Rules

Rules for coding agents working in this repository. People should read [CONTRIBUTING.md](CONTRIBUTING.md), which covers the same ground in more detail.

## Project

Switchboard is a local MCP aggregator. A daemon connects to the user's MCP servers and serves one MCP endpoint per **profile**. Each AI client (Cursor, Claude Code, VS Code, …) is given a profile by URL path, by the `X-Switchboard-Profile` header, or by its MCP `clientInfo.name`, and sees only that profile's tools, either directly or through search/execute meta-tools or code mode. A web UI served by the daemon manages servers, profiles and clients.

| Path | What it does |
|---|---|
| `apps/cli` | the published npm package `mcp-switchboard`: the `switchboard` command and the daemon entry point |
| `apps/web` | the admin web UI (Vite, React), built into the CLI package and served by the daemon |
| `apps/docs` | the docs site (Next.js, Fumadocs, Cloudflare Workers) |
| `packages/shared` | brand constants, zod schemas and types shared by the daemon and the web UI |
| `packages/core` | everything the daemon does: config store, catalog, upstream connections, profiles, tool surfaces, sandbox, client config writer, HTTP app |
| `.github` | CI, release workflow, templates |

Workspace packages (`@switchboard/*`) are private and consumed as TypeScript source; `apps/cli` bundles them with tsup. Only `mcp-switchboard` is published.

## Commands

```bash
pnpm install
pnpm build          # turbo: every package
pnpm test           # vitest in every package
pnpm typecheck      # tsc --noEmit in every package
pnpm lint           # biome check
pnpm biome check --write .   # fix formatting and imports
pnpm --filter mcp-switchboard dev   # run the daemon from source
```

Run `pnpm check` (lint, typecheck, test) before every commit.

## Dependencies

- Node 24 or later. Use `pnpm`, never npm or yarn, everywhere except `apps/docs`, which is a standalone npm project (`cd apps/docs && npm ci && npm run build`).
- Check the latest version with `npm view <package> version` before adding a dependency, and prefer the standard library.
- Native addons must be optional: the package has to install and run with `npx` on macOS, Linux and Windows without a compiler.

## Brand

Every user-visible name lives in `packages/shared/src/brand.ts`: use `brand.name`, `brand.packageName`, `brandEnv('PORT')`, `brand.defaultPort` and so on. Never write `"switchboard"`, `"SWITCHBOARD_"` or `".switchboard"` as literals in code. Docs and the website may use the names directly.

## Safety rules

- The daemon binds loopback only by default and checks `Host` and `Origin` on every request.
- A client must never see or call a tool outside its profile. Check access when listing **and** when calling, including calls made by `call_tool` and from code mode.
- Model-written code runs only in the sandbox, with time, memory, tool-call and output budgets. Never evaluate it with `eval`, `new Function` or `node:vm`.
- Never log secrets. Secret values are resolved at the last moment and masked in logs, errors and the web UI.
- Only stop processes the daemon started.
- When writing a client's configuration file, back it up first and only touch the entry Switchboard owns.
- Tests must never touch the real setup: use a temporary state directory (`SWITCHBOARD_HOME`) and a free port. Never write to the developer's real client configuration files in tests.

## Code style

- TypeScript, ESM, strict mode. Biome formats and lints; do not fight it.
- Small modules with one job. Prefer plain functions and data over classes, except for long-lived stateful things (connections, the daemon).
- Errors that reach a user or a model say what went wrong and what to do next.
- Comments explain why, not what.

## Tests

- Unit tests sit next to the code as `*.test.ts`.
- Integration tests start real MCP servers from `packages/core/test/fixtures` over stdio and HTTP.
- New behaviour and every bug fix come with a test.

## Commits

- One logical change per commit, imperative subject under about 72 characters, no trailing period, a body that explains why.
- No AI attribution trailers.
- User-facing changes get a line under `Unreleased` in `CHANGELOG.md` and updated docs in `apps/docs/content/docs`.
