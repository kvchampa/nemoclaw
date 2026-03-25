---
title:
  page: "Process Limits — Fork Bomb Protection"
  nav: "Process Limits"
description: "Fork bomb protection via cgroup pids.max and ulimit enforcement."
keywords: ["security", "fork bomb", "process limits", "pids-limit", "ulimit"]
topics: ["security"]
tags: ["hardening", "sandbox", "process-limits"]
content:
  type: reference
  difficulty: technical_beginner
  audience: ["operator", "contributor"]
status: published
---

<!--
  SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
  SPDX-License-Identifier: Apache-2.0
-->

# Process Limits

Without process limits, a prompt-injected agent can exhaust host resources by spawning processes recursively.

## Defence Layers

```{mermaid}
graph TD
    subgraph "Process Limit Enforcement"
        A[Agent spawns processes] --> B{ulimit -u set?}
        B -->|Yes| C[Kernel enforces RLIMIT_NPROC]
        B -->|No / unlimited| D[nemoclaw-start sets ulimit -u 512]
        D --> C
        C --> E{Over limit?}
        E -->|Yes| F[fork returns EAGAIN]
        E -->|No| G[Process created]
    end

    subgraph "Container Level"
        H[--pids-limit 512] --> I[cgroup pids.max]
        I --> C
    end

    F --> J[Agent receives error]
    J --> K[System stays responsive]
```

## Configuration

NemoClaw enforces a default process limit of 512 per sandbox.
This is sufficient for normal agent operation (typically < 50 processes) whilst preventing fork bombs.

| Setting | Where | Default |
|---------|-------|---------|
| `ulimit -u` | nemoclaw-start.sh | 512 (if unlimited) |
| `--pids-limit` | Container runtime | 512 (via `docker update`) |
| cgroup `pids.max` | Kernel | Set by container runtime |

## How It Works

1. **Container level (primary):** During onboarding, `nemoclaw onboard` calls `docker update --pids-limit 512` after sandbox creation.
This sets the cgroup `pids.max` value, which the kernel enforces regardless of what happens inside the container.

2. **In-sandbox fallback:** `nemoclaw-start.sh` checks `ulimit -u` at startup.
If the value is `unlimited` (meaning the container runtime did not set a limit), it sets `ulimit -u 512` as a safety net.

3. **Policy documentation:** The sandbox policy YAML documents that OpenShell does not currently expose a `pids_limit` field.
The limit must therefore be enforced at the container runtime level.

## Overriding the Default

Set `NEMOCLAW_PIDS_LIMIT` before running `nemoclaw onboard` to change the default.
The value must be a positive integer; non-numeric values are silently replaced with the default (512).

```console
$ NEMOCLAW_PIDS_LIMIT=1024 nemoclaw onboard
```
