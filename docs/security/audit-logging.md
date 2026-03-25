---
title: Audit Logging
description: Tamper-evident audit trail for NemoClaw gateway and orchestrator events.
keywords:
  - audit
  - logging
  - security
  - hash chain
topics:
  - security
  - observability
tags:
  - audit-logging
  - tamper-evident
content type: guide
difficulty: intermediate
audience: operators
status: draft
---

<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# Audit Logging

NemoClaw records a tamper-evident audit trail of gateway and orchestrator events.
This ensures that a sandboxed agent cannot cover its tracks by modifying log history.

## Problem

In the default configuration before this change, all logs lived under `/tmp/`.
This directory is fully writable by the sandbox user.
An agent could silently delete, truncate, or rewrite its own audit trail — making post-incident forensics unreliable.

## Solution

The fix applies three independent layers of protection:

1. **Log isolation** — Logs are written to `/var/log/nemoclaw/` instead of `/tmp/`.
   The directory is owned by `root:sandbox` with mode 750.
   The sandbox policy marks `/var/log` as read-only.

2. **Append-only enforcement** — The `audit.jsonl` file has the `chattr +a` (append-only) attribute set at image build time.
   Even with group-write permission, the kernel prevents any operation other than appending.

3. **Hash chaining** — Each log entry includes a SHA-256 hash of its payload and a `prev_hash` field linking to the previous entry.
   Any modification breaks the chain and is detectable offline.

## Verifying the audit chain

Run the built-in verification command against any audit log file:

```console
$ PYTHONPATH=/opt/nemoclaw-blueprint python3 -m orchestrator.audit verify /var/log/nemoclaw/audit.jsonl
```

Output on a valid chain:

```text
entries: 42
chain:   valid ✓
```

If tampering is detected, the tool reports the exact line where the chain broke:

```text
entries: 17
chain:   BROKEN ✗
detail:  line 18: hash mismatch (tampering detected)
```

## Future work

- **Remote SIEM shipping** — Forward audit events to Splunk or Elasticsearch in real time so that even host-level compromise cannot suppress the trail.
- **Landlock enforce mode** — Move from `best_effort` to `enforce` once the kernel compatibility matrix is validated across deployment targets.

## Next Steps

- [Sandbox Policy Reference](../reference/sandbox-policy.md) — Full list of filesystem and syscall restrictions.
- [Deployment Guide](../guides/deployment.md) — How to configure log paths and permissions in production.
- [Security Overview](index.md) — High-level security architecture of NemoClaw.
