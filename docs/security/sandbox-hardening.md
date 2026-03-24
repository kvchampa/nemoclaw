---
title:
  page: "Sandbox Image Hardening — Attack Surface Reduction"
  nav: "Sandbox Hardening"
description: "NemoClaw hardens the sandbox image by removing unnecessary tools that expand the attack surface."
keywords: ["security", "sandbox", "hardening", "gcc", "netcat", "attack surface"]
topics: ["security"]
tags: ["hardening", "dockerfile", "defence-in-depth"]
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

# Sandbox Image Hardening

NemoClaw hardens the sandbox image by stripping unnecessary tools that a compromised or prompt-injected agent could use.

## Removed Packages

| Package | Risk | Reference |
|---------|------|-----------|
| gcc, g++, cpp, make | Compile exploit code, LD_PRELOAD injection | [#807](https://github.com/NVIDIA/NemoClaw/issues/807) |
| netcat-openbsd, netcat-traditional | Reverse shells, raw TCP exfiltration | [#808](https://github.com/NVIDIA/NemoClaw/issues/808) |

## Defence Layers

```{mermaid}
graph TD
    subgraph "Sandbox Image Hardening"
        A[Base Image] -->|apt-get purge| B[No gcc/g++/make]
        A -->|apt-get purge| C[No netcat]
        B --> D[Cannot compile LD_PRELOAD libraries]
        B --> E[Cannot compile exploit code]
        C --> F[Cannot open reverse shells]
        C --> G[Cannot exfiltrate via raw TCP]
    end

    subgraph "Existing Defences"
        H[Landlock] --> I[Read-only /usr /etc /lib]
        J[Seccomp] --> K[Blocked syscalls]
        L[Network Proxy] --> M[Allowlisted egress only]
    end

    D --> N[Defence in Depth]
    F --> N
    H --> N
    J --> N
    L --> N
```

Even if one layer is bypassed, the others provide protection.
Removing tools from the image means an attacker who escapes the proxy still cannot compile custom tooling or open raw TCP connections.
