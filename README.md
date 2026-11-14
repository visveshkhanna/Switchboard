# Switchboard

**One local MCP endpoint for all your AI agents.**

Group your MCP servers into profiles, such as personal, work and a client's, and give Cursor, Claude Code, VS Code and every other agent only the tools it should see. Switchboard runs on your machine, starts servers only when a tool is called, and can shrink hundreds of tool definitions into a few search/execute tools or a single code-mode tool.

> Switchboard is new: v0.1.0 is the first release. Feedback and issues are welcome.

## Why

- **Profiles, not toggles.** Stop enabling and disabling servers in every project. Define `personal`, `acme` and `globex` once and point each client at the right one.
- **One process per server.** Ten clients share one copy of each MCP server, started on first use and stopped when idle.
- **Instant tool lists.** Tool catalogs are cached, so clients see their tools without waiting for servers to start.
- **Less context.** Large profiles can be served as `search_tools` / `get_schema` / `call_tool`, or as one `execute` tool where the model writes code that calls tools in a sandbox.
- **Connect in one click.** Switchboard writes the MCP entry into your client's configuration file for you, and can import the servers you already have.
- **Local and private.** Binds to loopback, keeps secrets in your OS keychain, no account and no cloud.

## Quick start

```bash
npx mcp-switchboard up
```

This starts the daemon and opens the web UI at <http://localhost:7690>. From there:

1. **Import** the MCP servers already configured in Cursor, Claude Code, Claude Desktop or VS Code, or add new ones.
2. **Create profiles** and choose the servers and tools in each.
3. **Connect** your clients: pick a client, pick a profile, and Switchboard updates its configuration.

## How a client picks a profile

Switchboard decides which profile a connection uses, in this order:

1. **URL path:** `http://localhost:7690/p/work/mcp`
2. **Header:** `X-Switchboard-Profile: work` on `http://localhost:7690/mcp`
3. **Client rules:** match the MCP client name, e.g. `cursor` → `work`, `claude-code` → `personal`
4. **Default profile**

```jsonc
// ~/.cursor/mcp.json
{
  "mcpServers": {
    "switchboard": { "url": "http://localhost:7690/p/work/mcp" }
  }
}
```

Clients that only speak stdio use the bridge:

```bash
switchboard connect --profile work
```

## Tool surfaces

Each profile chooses how its tools are presented:

| Surface | What the client sees | Best for |
|---|---|---|
| `passthrough` | every allowed tool, as is | small profiles |
| `meta` | `search_tools`, `get_schema`, `call_tool` | many tools, any model |
| `code` | `execute`: the model writes JavaScript that calls tools in a sandbox | multi-step work across tools |
| `auto` | `passthrough` for small profiles, `meta` above a threshold | the default |

## From the terminal

Everything in the web UI is also a command:

```bash
switchboard import                                   # servers from your AI clients
switchboard server add github -- npx -y @modelcontextprotocol/server-github
switchboard server add linear --url https://mcp.linear.app/mcp
switchboard server auth linear                       # OAuth sign-in in the browser
switchboard secret set github-token                  # use as secret://github-token
switchboard profile add work --servers github,linear --surface auto
switchboard client connect cursor --profile work
switchboard status
switchboard doctor
```

`config.json` in `~/.switchboard` is plain JSON that you can also edit by hand; the daemon reloads it and tells connected clients when their tools change.

## Documentation

Guides and reference: **<https://switchboard.visvesh.dev>**

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Report security problems as described in [SECURITY.md](SECURITY.md).

## License

[Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for credits.
