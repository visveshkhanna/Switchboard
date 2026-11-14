# Security policy

Switchboard runs a daemon on your machine that starts MCP servers, holds their credentials, forwards tool calls from AI clients, and can run model-written code in a sandbox. Reports about any of these are taken seriously.

## Supported versions

Security fixes go into the latest release. Please upgrade before reporting, and check whether the problem still happens.

| Version | Supported |
|---|---|
| Latest release | Yes |
| Older releases | No |

## Reporting a vulnerability

**Do not open a public issue.** Report it privately through [GitHub's vulnerability reporting](https://github.com/visveshkhanna/Switchboard/security/advisories/new), or by email to [visveshkhanna@gmail.com](mailto:visveshkhanna@gmail.com).

Please include:

- the Switchboard version (`switchboard --version`) and operating system;
- what an attacker can do, and what they need first (another local user, a malicious web page, a malicious MCP server, a prompt-injected model);
- steps to reproduce it, or a proof of concept.

You can expect an acknowledgement within a few days, and a fix or a plan within two weeks for confirmed issues. Once a fix is released, the advisory is published with credit to you, unless you prefer otherwise.

## What is in scope

- **Network exposure.** The daemon accepts connections from anything other than loopback by default, or a web page can reach the daemon through DNS rebinding or a missing `Origin` check.
- **Profile isolation.** A client sees or calls a tool that its profile does not allow, including through `call_tool` or code mode.
- **Code mode sandbox.** Model-written code escapes the sandbox, reaches the network, the file system or the host process, or runs past its time, memory or tool-call budget.
- **Secrets.** Credentials for MCP servers are written in plain text where the docs say they are not, appear in logs or the web UI, or are sent to a server other than the one they belong to.
- **Admin API.** Anything that changes configuration without the admin token.
- **Client configuration files.** `switchboard client connect` changes entries in a client's configuration that Switchboard did not create.
- **Releases.** The npm package or release archives can be swapped without the [build provenance](https://github.com/visveshkhanna/Switchboard/attestations) check noticing.

Bugs in third-party MCP servers that Switchboard runs are out of scope; please report them to those projects.
