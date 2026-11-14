# Changelog

All notable changes to Switchboard are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
