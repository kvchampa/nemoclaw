---
title:
  page: "Bridge MCP Servers into a NemoClaw Sandbox"
  nav: "Set Up MCP Bridge"
description: "Bridge host-side MCP servers into the sandbox so the OpenClaw agent can use external tools without exposing API keys."
keywords: ["NemoClaw mcp bridge", "mcp server sandbox", "mcporter OpenClaw", "model context protocol"]
topics: ["generative_ai", "ai_agents"]
tags: ["OpenClaw", "OpenShell", "mcp", "mcporter", "deployment", "NemoClaw"]
content:
  type: how_to
  difficulty: intermediate
  audience: ["developer", "engineer"]
---

<!--
  SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
  SPDX-License-Identifier: Apache-2.0
-->

# Bridge MCP Servers into a NemoClaw Sandbox

Bridge stdio-based MCP servers from the host into a NemoClaw sandbox so the OpenClaw agent can call external tools without exposing API keys inside the sandbox.

## How It Works

A stdio-to-HTTP proxy runs on the host, spawning the MCP server subprocess with the user's API keys from the host environment.
The proxy binds to `127.0.0.1` only and is not reachable from the network.
The sandbox reaches the proxy via `host.docker.internal` through OpenShell's egress proxy.
An egress rule is approved per MCP server so the sandbox can only reach the specific ports you allow.
mcporter inside the sandbox connects to the proxy as a standard HTTP MCP server.

```text
Host                                Sandbox
+------------------------+         +-----------------------+
|  stdio MCP server      |         |  mcporter             |
|    |                   |  egress |    |                  |
|  stdio-to-HTTP proxy   |  rule   |  host.docker.internal |
|    127.0.0.1:3101      |<--------|    :3101              |
|                        |         |                       |
|  API keys stay here    |         |  OpenClaw agent       |
+------------------------+         |    (no API keys)      |
                                   +-----------------------+
```

This follows the same pattern as the Telegram bridge: the proxy runs on the host with credentials, and the sandbox reaches it through a scoped egress policy.

## Prerequisites

- A running NemoClaw sandbox created with the base policy (`--policy` flag).
- An MCP server command, for example `npx @modelcontextprotocol/server-github`.
- The required API key exported as an environment variable on the host.

## Add an MCP Server

Export the API key on the host.
The bridge reads the variable name from the host environment and passes it to the MCP server process.
The key never enters the sandbox.

```console
$ export GITHUB_TOKEN=<your-token>
$ nemoclaw <name> mcp add --name github \
    --command "npx @modelcontextprotocol/server-github" \
    --env GITHUB_TOKEN
```

This command:

1. Starts the stdio-to-HTTP proxy on the host, bound to `127.0.0.1`.
2. Triggers a connection from the sandbox to generate a pending egress rule for `host.docker.internal:<port>`.
3. Approves the egress rule via `openshell rule approve`.
4. Installs mcporter in the sandbox if not already present.
5. Registers the server in the sandbox mcporter configuration pointing to `http://host.docker.internal:<port>`.

## List Bridges

List all MCP bridges for a sandbox with their running status.

```console
$ nemoclaw <name> mcp list
```

```text
MCP Bridges for sandbox "my-assistant":

  * github      :3101  npx @modelcontextprotocol/server-github      env: GITHUB_TOKEN
  * slack       :3102  npx @anthropic/mcp-server-slack               env: SLACK_TOKEN
```

A green dot indicates a running proxy.
A red dot indicates the proxy has stopped and needs to be restarted.

## Remove a Bridge

Stop the proxy and remove the server from the sandbox mcporter configuration.

```console
$ nemoclaw <name> mcp remove github
```

## Restart After Reboot

Proxy processes do not survive a host reboot.
Restart all proxy processes from the saved configuration.
The sandbox-side mcporter configuration persists and does not need to be rewritten.

```console
$ nemoclaw <name> mcp restart
```

To restart a single bridge, pass the server name.

```console
$ nemoclaw <name> mcp restart github
```

## Egress Rule Approval

Each MCP bridge requires an egress rule allowing the sandbox to reach `host.docker.internal` on the proxy port.
The `mcp add` command approves this rule automatically via `openshell rule approve`.

If automatic approval fails, approve manually:

```console
$ openshell rule get <name>
$ openshell rule approve --chunk-id <chunk-id> <name>
```

You can also approve rules through the OpenShell TUI:

```console
$ openshell term
```

## CLI Reference

| Command | Description |
|---------|-------------|
| `nemoclaw <name> mcp add --name <id> --command <cmd> [--env VAR ...] [--port PORT]` | Bridge a host MCP server into the sandbox |
| `nemoclaw <name> mcp list` | List bridges with running status |
| `nemoclaw <name> mcp remove <id>` | Stop and remove a bridge |
| `nemoclaw <name> mcp restart [<id>]` | Restart all or one bridge after reboot |

### Flags

`--name <id>`
: Required. Alphanumeric identifier for the MCP server.

`--command <cmd>`
: Required. The command to spawn the MCP server (e.g., `"npx @modelcontextprotocol/server-github"`).

`--env VAR`
: Repeatable. Name of an environment variable to pass from the host to the MCP server process.
  The bridge reads the value from the host environment. The value never enters the sandbox.

`--port PORT`
: Optional. Host port for the proxy (default: auto-assigned from range 3100-3199).

## Manual Setup

The CLI commands above automate these steps.
Use the manual process if you need to customize the proxy or debug the connection.

### Start the Proxy

```console
$ node scripts/mcp-proxy.js \
    --exe npx \
    --arg @modelcontextprotocol/server-github \
    --env GITHUB_TOKEN \
    --port 3101 &
```

### Approve the Egress Rule

Trigger a connection attempt from the sandbox and approve the resulting rule:

```console
$ nemoclaw <name> connect
sandbox@<name>:~$ curl -s http://host.docker.internal:3101
sandbox@<name>:~$ exit
$ openshell rule get <name>
$ openshell rule approve --chunk-id <id> <name>
```

### Register in the Sandbox

```console
$ nemoclaw <name> connect
sandbox@<name>:~$ mcporter config add github --url http://host.docker.internal:3101 --scope home
sandbox@<name>:~$ mcporter list github
```

If the tool list is returned, the bridge is working.

## Security

| Layer | Protection |
|-------|-----------|
| API keys | Stay in host environment variables. Never written to sandbox filesystem. |
| Proxy binding | Listens on `127.0.0.1` only. Not reachable from the local network. |
| Egress policy | Each MCP server gets a scoped rule for `host.docker.internal:<port>`. No blanket egress. |
| Egress approval | Rules require explicit approval via `openshell rule approve` or the TUI. |
| Sandbox isolation | Filesystem, network, and process policies still enforced by OpenShell. |

## Next Steps

- [Set Up Telegram Bridge](set-up-telegram-bridge.md) for another auxiliary service pattern.
- [Commands](../reference/commands.md) for the full CLI reference.
- [Network Policies](../reference/network-policies.md) for egress control.
