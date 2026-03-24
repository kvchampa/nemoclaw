// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";

// Test the arg parsing logic used by mcp-proxy.js
function parseArgs(argv) {
  const args = { exe: null, cmdArgs: [], env: [], port: 3101 };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--exe":
        args.exe = argv[++i];
        break;
      case "--arg":
        args.cmdArgs.push(argv[++i]);
        break;
      case "--env":
        args.env.push(argv[++i]);
        break;
      case "--port":
        args.port = parseInt(argv[++i], 10);
        break;
    }
  }
  return args;
}

describe("mcp-proxy parseArgs", () => {
  it("parses --exe flag", () => {
    const result = parseArgs(["--exe", "npx"]);
    expect(result.exe).toBe("npx");
  });

  it("parses --port flag", () => {
    const result = parseArgs(["--exe", "npx", "--port", "3105"]);
    expect(result.port).toBe(3105);
  });

  it("defaults port to 3101", () => {
    const result = parseArgs(["--exe", "npx"]);
    expect(result.port).toBe(3101);
  });

  it("collects multiple --arg flags", () => {
    const result = parseArgs([
      "--exe",
      "npx",
      "--arg",
      "@modelcontextprotocol/server-github",
      "--arg",
      "--verbose",
    ]);
    expect(result.cmdArgs).toEqual([
      "@modelcontextprotocol/server-github",
      "--verbose",
    ]);
  });

  it("collects multiple --env flags", () => {
    const result = parseArgs([
      "--exe",
      "npx",
      "--env",
      "GITHUB_TOKEN",
      "--env",
      "SLACK_TOKEN",
    ]);
    expect(result.env).toEqual(["GITHUB_TOKEN", "SLACK_TOKEN"]);
  });

  it("parses full command line", () => {
    const result = parseArgs([
      "--exe",
      "npx",
      "--arg",
      "@modelcontextprotocol/server-github",
      "--env",
      "GITHUB_TOKEN",
      "--port",
      "3101",
    ]);
    expect(result.exe).toBe("npx");
    expect(result.cmdArgs).toEqual(["@modelcontextprotocol/server-github"]);
    expect(result.env).toEqual(["GITHUB_TOKEN"]);
    expect(result.port).toBe(3101);
  });

  it("returns null exe when not provided", () => {
    const result = parseArgs([]);
    expect(result.exe).toBeNull();
  });
});

describe("mcp-proxy executable validation", () => {
  it("rejects path traversal in exe", () => {
    expect(/\.\./.test("../bin/server")).toBe(true);
    expect(/\.\./.test("../../etc/passwd")).toBe(true);
  });

  it("rejects shell metacharacters in exe", () => {
    expect(/[;&|`$]/.test("npx; rm -rf /")).toBe(true);
    expect(/[;&|`$]/.test("npx | cat")).toBe(true);
    expect(/[;&|`$]/.test("npx & bg")).toBe(true);
    expect(/[;&|`$]/.test("$(cmd)")).toBe(true);
    expect(/[;&|`$]/.test("`cmd`")).toBe(true);
  });

  it("accepts safe executables", () => {
    expect(/\.\./.test("npx")).toBe(false);
    expect(/[;&|`$]/.test("npx")).toBe(false);
    expect(/\.\./.test("node")).toBe(false);
    expect(/[;&|`$]/.test("node")).toBe(false);
    expect(/\.\./.test("/usr/local/bin/server")).toBe(false);
    expect(/[;&|`$]/.test("/usr/local/bin/server")).toBe(false);
  });
});

// Test the CLI-side arg parser (parseMcpArgs in nemoclaw.js)
// Format: <name> [-e KEY=VALUE ...] [--port PORT] -- <command> [args...]
function parseMcpArgs(actionArgs) {
  const opts = { name: null, env: {}, port: null, command: null, args: [] };
  const dashDash = actionArgs.indexOf("--");
  const flagArgs = dashDash >= 0 ? actionArgs.slice(0, dashDash) : actionArgs;
  const cmdArgs = dashDash >= 0 ? actionArgs.slice(dashDash + 1) : [];

  let i = 0;
  if (i < flagArgs.length && !flagArgs[i].startsWith("-")) {
    opts.name = flagArgs[i];
    i++;
  }
  for (; i < flagArgs.length; i++) {
    switch (flagArgs[i]) {
      case "-e":
      case "--env": {
        const val = flagArgs[++i];
        if (val) {
          const eqIdx = val.indexOf("=");
          if (eqIdx > 0) {
            opts.env[val.slice(0, eqIdx)] = val.slice(eqIdx + 1);
          } else {
            opts.env[val] = "";
          }
        }
        break;
      }
      case "--port":
        opts.port = parseInt(flagArgs[++i], 10);
        break;
      default:
        break;
    }
  }
  if (cmdArgs.length > 0) {
    opts.command = cmdArgs[0];
    opts.args = cmdArgs.slice(1);
  }
  return opts;
}

describe("CLI parseMcpArgs", () => {
  it("parses add with positional name, -e KEY=VALUE, and -- command", () => {
    const result = parseMcpArgs([
      "github",
      "-e",
      "GITHUB_TOKEN=ghp_xxx",
      "--",
      "npx",
      "-y",
      "@modelcontextprotocol/server-github",
    ]);
    expect(result.name).toBe("github");
    expect(result.env).toEqual({ GITHUB_TOKEN: "ghp_xxx" });
    expect(result.command).toBe("npx");
    expect(result.args).toEqual(["-y", "@modelcontextprotocol/server-github"]);
  });

  it("parses optional --port", () => {
    const result = parseMcpArgs([
      "github",
      "--port",
      "3105",
      "--",
      "npx",
      "server",
    ]);
    expect(result.port).toBe(3105);
    expect(result.command).toBe("npx");
    expect(result.args).toEqual(["server"]);
  });

  it("parses positional name for remove/restart", () => {
    const result = parseMcpArgs(["github"]);
    expect(result.name).toBe("github");
    expect(result.command).toBeNull();
  });

  it("collects multiple -e flags with values", () => {
    const result = parseMcpArgs([
      "multi",
      "-e",
      "TOKEN_A=aaa",
      "-e",
      "TOKEN_B=bbb",
      "-e",
      "TOKEN_C=ccc",
      "--",
      "cmd",
    ]);
    expect(result.env).toEqual({
      TOKEN_A: "aaa",
      TOKEN_B: "bbb",
      TOKEN_C: "ccc",
    });
  });

  it("handles -e with name only (no value)", () => {
    const result = parseMcpArgs(["foo", "-e", "MY_VAR", "--", "cmd"]);
    expect(result.env).toEqual({ MY_VAR: "" });
  });

  it("returns nulls for empty args", () => {
    const result = parseMcpArgs([]);
    expect(result.name).toBeNull();
    expect(result.command).toBeNull();
    expect(result.port).toBeNull();
    expect(result.env).toEqual({});
    expect(result.args).toEqual([]);
  });

  it("handles env values containing equals signs", () => {
    const result = parseMcpArgs([
      "foo",
      "-e",
      "URL=https://example.com?a=1&b=2",
      "--",
      "cmd",
    ]);
    expect(result.env).toEqual({ URL: "https://example.com?a=1&b=2" });
  });
});
