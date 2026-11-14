# Contributing to Switchboard

Thanks for helping with Switchboard. Bug reports, support for more AI clients, docs fixes and code are all welcome. This guide covers how to get set up, how to make a change, and what a pull request needs.

Everyone taking part is expected to follow the [code of conduct](CODE_OF_CONDUCT.md). To report a security problem, follow the [security policy](SECURITY.md) instead of opening an issue.

- [Finding something to do](#finding-something-to-do)
- [Setting up](#setting-up)
- [Making a change](#making-a-change)
- [Checklist for pull requests](#checklist-for-pull-requests)
- [Code style](#code-style)
- [Tests](#tests)
- [Documentation](#documentation)
- [Adding an AI client](#adding-an-ai-client)
- [Releases](#releases)

## Finding something to do

- Issues labelled [`good first issue`](https://github.com/visveshkhanna/Switchboard/labels/good%20first%20issue) and [`help wanted`](https://github.com/visveshkhanna/Switchboard/labels/help%20wanted) are a good start.
- An AI client that Switchboard cannot connect automatically is worth [adding](#adding-an-ai-client).
- An MCP server that misbehaves behind Switchboard but works directly is worth a bug report.

For anything larger than a small fix, open an issue or a [discussion](https://github.com/visveshkhanna/Switchboard/discussions) first, so we can agree on the approach before you spend time on it.

## Setting up

Switchboard needs Node 24 or later and pnpm 10.

```bash
git clone https://github.com/<you>/Switchboard && cd Switchboard
corepack enable
pnpm install
pnpm build
node apps/cli/dist/cli.js --version
```

To try a change without touching the Switchboard you use day to day, give it its own state directory and port:

```bash
SWITCHBOARD_HOME=/tmp/switchboard-dev SWITCHBOARD_PORT=17690 pnpm --filter mcp-switchboard dev
```

### Layout

| Path | What it does |
|---|---|
| `apps/cli` | the `switchboard` command and the daemon entry point, published as `mcp-switchboard` |
| `apps/web` | the admin web UI |
| `apps/docs` | the docs site |
| `packages/shared` | brand constants, schemas and types shared by the daemon and the web UI |
| `packages/core` | the daemon: config, catalog, upstream connections, profiles, tool surfaces, sandbox, client config writer |

## Making a change

1. Fork the repository and create a branch from `main`, named after the change: `fix-sse-reconnect`, `client-zed`.
2. Make the change, with tests. Keep each commit to one logical change that builds and passes the tests on its own.
3. Add a line to the `Unreleased` section of [CHANGELOG.md](CHANGELOG.md) if users will notice the change, under `Added`, `Changed`, `Fixed` or `Removed`.
4. Update the [docs](#documentation) if behaviour, a command or an option changed.
5. Run the checks in the [checklist](#checklist-for-pull-requests), push, and open a pull request against `main`.

### Commit messages

- A subject line in the imperative, under about 72 characters, without a trailing period: `Reconnect SSE servers after the laptop wakes`.
- A body, after a blank line, that says why the change is needed and anything a reviewer would not see from the diff.
- One logical change per commit. Formatting-only changes go in their own commit.

## Checklist for pull requests

- [ ] `pnpm lint` passes (`pnpm biome check --write .` fixes most problems).
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm test` passes, with new tests for new behaviour and for fixed bugs.
- [ ] User-facing changes have a `CHANGELOG.md` entry and updated docs.

## Code style

- TypeScript, ESM, strict mode, formatted by Biome.
- Every user-visible name comes from `packages/shared/src/brand.ts`.
- Errors shown to users or models say what went wrong and what to do about it.

## Tests

Unit tests sit next to the code as `*.test.ts`. Integration tests in `packages/core/test` start real MCP servers from `packages/core/test/fixtures`. Tests use a temporary `SWITCHBOARD_HOME` and a free port, and never touch real client configuration files.

## Documentation

The docs site lives in `apps/docs` and is built with [Fumadocs](https://fumadocs.dev). Pages are MDX files in `apps/docs/content/docs`.

```bash
cd apps/docs
npm ci
npm run dev
```

## Adding an AI client

Client configuration files are described as data in `packages/core/src/clients/registry.ts`: where the file lives on each OS, its format, the key that holds MCP servers, and how an HTTP entry is written. Add an entry, a test with a sample file, and a line in the docs' client list.

## Releases

Maintainers release by moving the `Unreleased` section of `CHANGELOG.md` under a new version heading, setting the version in `apps/cli/package.json`, and pushing a `vX.Y.Z` tag. The release workflow tests, builds, publishes to npm with provenance and creates the GitHub release with the changelog notes.
