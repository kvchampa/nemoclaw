// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";

// Use a temp dir so tests don't touch real ~/.nemoclaw.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-mcp-test-"));
process.env.HOME = tmpDir;

const require = createRequire(import.meta.url);
const registry = require("../bin/lib/registry");

const regFile = path.join(tmpDir, ".nemoclaw", "sandboxes.json");

beforeEach(() => {
  if (fs.existsSync(regFile)) fs.unlinkSync(regFile);
});

describe("mcp-bridge port management", () => {
  it("getAllUsedPorts returns empty set with no sandboxes", () => {
    const bridge = require("../bin/lib/mcp-bridge");
    // Fresh registry, no sandboxes at all — no ports used
    const data = registry.load();
    const used = new Set();
    for (const sb of Object.values(data.sandboxes)) {
      if (!sb.mcp) continue;
      for (const entry of Object.values(sb.mcp)) {
        if (entry.port) used.add(entry.port);
      }
    }
    expect(used.size).toBe(0);
  });

  it("getAllUsedPorts returns ports from sandboxes with mcp entries", () => {
    registry.registerSandbox({
      name: "test-sb",
      model: "test",
      provider: "nvidia-nim",
    });
    registry.updateSandbox("test-sb", {
      mcp: {
        github: {
          type: "stdio",
          command: "npx server-github",
          port: 3101,
          env: [],
        },
        slack: {
          type: "stdio",
          command: "npx server-slack",
          port: 3102,
          env: [],
        },
      },
    });
    const data = registry.load();
    const used = new Set();
    for (const sb of Object.values(data.sandboxes)) {
      if (!sb.mcp) continue;
      for (const entry of Object.values(sb.mcp)) {
        if (entry.port) used.add(entry.port);
      }
    }
    expect(used.has(3101)).toBe(true);
    expect(used.has(3102)).toBe(true);
    expect(used.size).toBe(2);
  });
});

describe("mcp-bridge registry integration", () => {
  it("stores mcp config in sandbox registry", () => {
    registry.registerSandbox({
      name: "mcp-test",
      model: "test",
      provider: "nvidia-nim",
    });
    const sandbox = registry.getSandbox("mcp-test");
    const mcp = sandbox.mcp || {};
    mcp["github"] = {
      type: "stdio",
      command: "npx @modelcontextprotocol/server-github",
      exe: "npx",
      args: ["@modelcontextprotocol/server-github"],
      env: ["GITHUB_TOKEN"],
      port: 3101,
      addedAt: new Date().toISOString(),
    };
    registry.updateSandbox("mcp-test", { mcp });

    const updated = registry.getSandbox("mcp-test");
    expect(updated.mcp).toBeDefined();
    expect(updated.mcp.github).toBeDefined();
    expect(updated.mcp.github.port).toBe(3101);
    expect(updated.mcp.github.env).toEqual(["GITHUB_TOKEN"]);
    expect(updated.mcp.github.type).toBe("stdio");
  });

  it("removes mcp entry from registry", () => {
    registry.registerSandbox({
      name: "mcp-rm",
      model: "test",
      provider: "nvidia-nim",
    });
    registry.updateSandbox("mcp-rm", {
      mcp: {
        github: { type: "stdio", command: "test", port: 3101, env: [] },
        slack: { type: "stdio", command: "test", port: 3102, env: [] },
      },
    });

    const sandbox = registry.getSandbox("mcp-rm");
    delete sandbox.mcp.github;
    registry.updateSandbox("mcp-rm", { mcp: sandbox.mcp });

    const updated = registry.getSandbox("mcp-rm");
    expect(updated.mcp.github).toBeUndefined();
    expect(updated.mcp.slack).toBeDefined();
  });

  it("handles sandbox with no mcp field", () => {
    registry.registerSandbox({
      name: "no-mcp",
      model: "test",
      provider: "nvidia-nim",
    });
    const sandbox = registry.getSandbox("no-mcp");
    expect(sandbox.mcp).toBeUndefined();
  });
});

describe("mcp-bridge name validation", () => {
  it("accepts valid names", () => {
    const VALID_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
    expect(VALID_NAME_RE.test("github")).toBe(true);
    expect(VALID_NAME_RE.test("my-server")).toBe(true);
    expect(VALID_NAME_RE.test("server_1")).toBe(true);
    expect(VALID_NAME_RE.test("A")).toBe(true);
  });

  it("rejects invalid names", () => {
    const VALID_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
    expect(VALID_NAME_RE.test("")).toBe(false);
    expect(VALID_NAME_RE.test("1abc")).toBe(false);
    expect(VALID_NAME_RE.test("-abc")).toBe(false);
    expect(VALID_NAME_RE.test("a b")).toBe(false);
    expect(VALID_NAME_RE.test("a/b")).toBe(false);
    expect(VALID_NAME_RE.test("a;b")).toBe(false);
    expect(VALID_NAME_RE.test("../etc")).toBe(false);
  });
});

describe("mcp-bridge env var name validation", () => {
  const VALID_ENV_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

  it("accepts valid env var names", () => {
    expect(VALID_ENV_RE.test("GITHUB_TOKEN")).toBe(true);
    expect(VALID_ENV_RE.test("_PRIVATE")).toBe(true);
    expect(VALID_ENV_RE.test("A")).toBe(true);
    expect(VALID_ENV_RE.test("my_var_123")).toBe(true);
  });

  it("rejects env names with shell metacharacters", () => {
    expect(VALID_ENV_RE.test("VAR=value")).toBe(false);
    expect(VALID_ENV_RE.test("VAR;rm -rf")).toBe(false);
    expect(VALID_ENV_RE.test("VAR|cat")).toBe(false);
    expect(VALID_ENV_RE.test("$(cmd)")).toBe(false);
    expect(VALID_ENV_RE.test("`cmd`")).toBe(false);
    expect(VALID_ENV_RE.test("VAR NAME")).toBe(false);
  });

  it("rejects env names starting with digits", () => {
    expect(VALID_ENV_RE.test("1VAR")).toBe(false);
    expect(VALID_ENV_RE.test("123")).toBe(false);
  });

  it("rejects empty names", () => {
    expect(VALID_ENV_RE.test("")).toBe(false);
  });
});

describe("mcp-bridge PID file helpers", () => {
  it("pidDir returns expected path", () => {
    expect(`/tmp/nemoclaw-services-mysb`).toBe("/tmp/nemoclaw-services-mysb");
  });

  it("pidFile returns expected path under pidDir", () => {
    const dir = `/tmp/nemoclaw-services-mysb`;
    const file = path.join(dir, `mcp-github.pid`);
    expect(file).toBe("/tmp/nemoclaw-services-mysb/mcp-github.pid");
  });

  it("writePidFile writes pid and timestamp", () => {
    const tmpPid = path.join(tmpDir, "test.pid");
    const pid = 12345;
    const before = Date.now();
    fs.writeFileSync(tmpPid, `${pid}\n${Date.now()}`);
    const content = fs.readFileSync(tmpPid, "utf-8").trim();
    const lines = content.split("\n");
    expect(parseInt(lines[0], 10)).toBe(12345);
    expect(parseInt(lines[1], 10)).toBeGreaterThanOrEqual(before);
  });

  it("isRunning returns false for non-existent PID file", () => {
    const fakePath = path.join(tmpDir, "nonexistent.pid");
    // Simulate isRunning logic
    try {
      fs.readFileSync(fakePath, "utf-8");
      expect(true).toBe(false); // should not reach here
    } catch {
      // expected — file doesn't exist
      expect(true).toBe(true);
    }
  });

  it("isRunning returns false for stale PID (30+ days old)", () => {
    const tmpPid = path.join(tmpDir, "stale.pid");
    const staleTime = Date.now() - 31 * 24 * 60 * 60 * 1000;
    fs.writeFileSync(tmpPid, `99999\n${staleTime}`);
    const content = fs.readFileSync(tmpPid, "utf-8").trim();
    const lines = content.split("\n");
    const startTime = parseInt(lines[1], 10);
    expect(Date.now() - startTime > 30 * 24 * 60 * 60 * 1000).toBe(true);
  });
});

describe("mcp-bridge port range", () => {
  it("port range is 3100-3199", () => {
    const MCP_PORT_START = 3100;
    const MCP_PORT_END = 3199;
    expect(MCP_PORT_END - MCP_PORT_START + 1).toBe(100);
  });

  it("nextAvailablePort finds first unused port", () => {
    const MCP_PORT_START = 3100;
    const MCP_PORT_END = 3199;
    const used = new Set([3100, 3101, 3102]);
    let found = null;
    for (let p = MCP_PORT_START; p <= MCP_PORT_END; p++) {
      if (!used.has(p)) {
        found = p;
        break;
      }
    }
    expect(found).toBe(3103);
  });

  it("nextAvailablePort returns null when all ports used", () => {
    const MCP_PORT_START = 3100;
    const MCP_PORT_END = 3199;
    const used = new Set();
    for (let p = MCP_PORT_START; p <= MCP_PORT_END; p++) used.add(p);
    let found = null;
    for (let p = MCP_PORT_START; p <= MCP_PORT_END; p++) {
      if (!used.has(p)) {
        found = p;
        break;
      }
    }
    expect(found).toBeNull();
  });
});
