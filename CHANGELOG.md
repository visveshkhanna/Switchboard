# Changelog

All notable changes to Switchboard are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-11-14

Servers start as soon as they are added and restart when they crash, any MCP client can connect and wait for a profile, an opt-in activity log feeds new charts, and the web UI is rebuilt.

### Added

- An opt-in activity log: `switchboard up` asks on first start, and `switchboard activity on|off` changes it. Only tool names, timing and success are kept, for `settings.retentionDays` days.
- `GET /api/stats` and `GET`/`PUT /api/settings` for the activity charts and settings.
- Servers with `idleTimeoutSec: 0` start with the daemon and are kept running.
- `switchboard client connect ID --auto` and `switchboard connect` without `--profile` use the shared `/mcp` endpoint, where client rules and the default profile pick the profile.
- Every MCP client that connects is remembered in `seen-clients.json`, including clients without a preset, and `GET /api/seen-clients` lists them. `PUT /api/seen-clients/:name/profile` gives one a profile.

### Changed

- A client that connects to the shared `/mcp` URL without a matching rule or default profile is no longer refused: it waits with no tools, and gets its tools as soon as it is given a profile, without reconnecting.
- Sessions whose profile comes from a client rule or the default profile follow changes to the rules.
- The dashboard and the docs site share the black patch-panel logo.
- The web UI is rebuilt with shadcn/ui: light and dark themes, a collapsible sidebar, onboarding and copy-paste connection snippets on the overview, a "Set up with AI" prompt, a clearer Clients page with an automatic (client rules) option, sticky profile previews, and charts of calls, errors and latency on the Activity page.

### Fixed

- Adding a server, or adding one to a profile a client already uses, now starts it to discover its tools and tells connected clients, instead of waiting until the server was tested by hand.
- A server that crashes is restarted automatically with backoff.
- Hand edits of `config.json` are no longer missed when the file watcher drops an event.
- A remote server waiting for OAuth sign-in is no longer restarted as if it had crashed.
- Menu and select items show a hover state, and the selected Activity time range is highlighted.
- Ctrl+C stops `switchboard up` at once instead of waiting for the web UI's open event stream, and stops the MCP servers it started; a second Ctrl+C exits immediately.

## [0.1.0] - 2026-11-14

The first release.

### Added

- Monorepo scaffold: pnpm workspaces, Turborepo, Biome, Vitest and TypeScript.
- A daemon that aggregates stdio, Streamable HTTP and SSE MCP servers and serves one MCP endpoint per profile at `/p/<profile>/mcp`.
- Profiles built from servers, `include` and `exclude` tool patterns, and per-tool name and description overrides.
- Profile selection by URL path, the `X-Switchboard-Profile` header, client rules on the MCP client name, or a default profile.
- One shared process per upstream server, started on first use and stopped when idle, with retries and backoff.
- A persisted tool catalog, so `tools/list` answers without starting servers.
- Live `tools/list_changed` notifications when a profile or an upstream server's tools change.
- `config.json` is reloaded when edited by hand; invalid edits are reported and ignored.
- An audit log of tool calls, without arguments or results.
- Loopback-only binding with `Host` and `Origin` checks.
- The `meta` tool surface: `search_tools`, `get_schema` and `call_tool` replace a profile's tools with three, whatever its size.
- Offline BM25 tool search that understands camelCase and snake_case names.
- Tool schemas rendered as TypeScript signatures for models.
- The `auto` surface, which switches from `passthrough` to `meta` above `autoThreshold` tools.
- The `code` tool surface: one `execute` tool runs model-written JavaScript that calls the profile's tools as typed methods, such as `await github.create_issue({...})`.
- A QuickJS WebAssembly sandbox for code mode with no access to Node, the network or the file system, and per-profile budgets for time, memory, tool calls, code size and output size.
- `catalog.search()` and `catalog.describe()` inside the sandbox for profiles too large to describe up front.
- An admin API and a web UI to manage servers, profiles, client connections, secrets and live activity.
- One-click connection of Cursor, Claude Code, Claude Desktop, VS Code, Windsurf, Codex and Gemini CLI, editing their configuration files in place with a backup.
- Import of the MCP servers already configured in those clients.
- Secrets referenced as `secret://name`, stored in the OS keychain when available.
- OAuth sign-in for remote MCP servers, with tokens kept in the secret store.
- The `switchboard` CLI: `up`, `stop`, `status`, `doctor`, `import`, `server`, `profile`, `default`, `rule`, `client`, `secret` and the `connect` stdio bridge.

[Unreleased]: https://github.com/visveshkhanna/Switchboard/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/visveshkhanna/Switchboard/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/visveshkhanna/Switchboard/releases/tag/v0.1.0
