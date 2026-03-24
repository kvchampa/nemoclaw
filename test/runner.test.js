// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import childProcess from "node:child_process";
const { spawnSync } = childProcess;

const runnerPath = path.join(import.meta.dirname, "..", "bin", "lib", "runner");

describe("runner helpers", () => {
  it("does not let child commands consume installer stdin", () => {
    const script = `
      const { run } = require(${JSON.stringify(runnerPath)});
      process.stdin.setEncoding("utf8");
      run("cat >/dev/null || true");
      process.stdin.once("data", (chunk) => {
        process.stdout.write(chunk);
      });
    `;

    const result = spawnSync("node", ["-e", script], {
      cwd: path.join(import.meta.dirname, ".."),
      encoding: "utf-8",
      input: "preserved-answer\n",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("preserved-answer\n");
  });

  it("uses inherited stdio for interactive commands only", () => {
    const calls = [];
    const originalSpawnSync = childProcess.spawnSync;
    childProcess.spawnSync = (...args) => {
      calls.push(args);
      return { status: 0 };
    };

    try {
      delete require.cache[require.resolve(runnerPath)];
      const { run, runInteractive } = require(runnerPath);
      run("echo noninteractive");
      runInteractive("echo interactive");
    } finally {
      childProcess.spawnSync = originalSpawnSync;
      delete require.cache[require.resolve(runnerPath)];
    }

    expect(calls.length).toBe(2);
    expect(calls[0][2].stdio).toEqual(["ignore", "inherit", "inherit"]);
    expect(calls[1][2].stdio).toBe("inherit");
  });

  it("preserves process env when opts.env is provided", () => {
    const calls = [];
    const originalSpawnSync = childProcess.spawnSync;
    const originalPath = process.env.PATH;
    childProcess.spawnSync = (...args) => {
      calls.push(args);
      return { status: 0 };
    };

    try {
      delete require.cache[require.resolve(runnerPath)];
      const { run } = require(runnerPath);
      process.env.PATH = "/usr/local/bin:/usr/bin";
      run("echo test", { env: { OPENSHELL_CLUSTER_IMAGE: "ghcr.io/nvidia/openshell/cluster:0.0.12" } });
    } finally {
      if (originalPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = originalPath;
      }
      childProcess.spawnSync = originalSpawnSync;
      delete require.cache[require.resolve(runnerPath)];
    }

    expect(calls.length).toBe(1);
    expect(calls[0][2].env.OPENSHELL_CLUSTER_IMAGE).toBe("ghcr.io/nvidia/openshell/cluster:0.0.12");
    expect(calls[0][2].env.PATH).toBe("/usr/local/bin:/usr/bin");
  });

  describe("shellQuote", () => {
    it("wraps in single quotes", () => {
      const { shellQuote } = require(runnerPath);
      expect(shellQuote("hello")).toBe("'hello'");
    });

    it("escapes embedded single quotes", () => {
      const { shellQuote } = require(runnerPath);
      expect(shellQuote("it's")).toBe("'it'\\''s'");
    });

    it("neutralizes shell metacharacters", () => {
      const { shellQuote } = require(runnerPath);
      const dangerous = "test; rm -rf /";
      const quoted = shellQuote(dangerous);
      expect(quoted).toBe("'test; rm -rf /'");
      const result = spawnSync("bash", ["-c", `echo ${quoted}`], { encoding: "utf-8" });
      expect(result.stdout.trim()).toBe(dangerous);
    });

    it("handles backticks and dollar signs", () => {
      const { shellQuote } = require(runnerPath);
      const payload = "test`whoami`$HOME";
      const quoted = shellQuote(payload);
      const result = spawnSync("bash", ["-c", `echo ${quoted}`], { encoding: "utf-8" });
      expect(result.stdout.trim()).toBe(payload);
    });
  });

  describe("validateName", () => {
    it("accepts valid RFC 1123 names", () => {
      const { validateName } = require(runnerPath);
      expect(validateName("my-sandbox")).toBe("my-sandbox");
      expect(validateName("test123")).toBe("test123");
      expect(validateName("a")).toBe("a");
    });

    it("rejects names with shell metacharacters", () => {
      const { validateName } = require(runnerPath);
      expect(() => validateName("test; whoami")).toThrow(/Invalid/);
      expect(() => validateName("test`id`")).toThrow(/Invalid/);
      expect(() => validateName("test$(cat /etc/passwd)")).toThrow(/Invalid/);
      expect(() => validateName("../etc/passwd")).toThrow(/Invalid/);
    });

    it("rejects empty and overlength names", () => {
      const { validateName } = require(runnerPath);
      expect(() => validateName("")).toThrow(/required/);
      expect(() => validateName(null)).toThrow(/required/);
      expect(() => validateName("a".repeat(64))).toThrow(/too long/);
    });

    it("rejects uppercase and special characters", () => {
      const { validateName } = require(runnerPath);
      expect(() => validateName("MyBox")).toThrow(/Invalid/);
      expect(() => validateName("my_box")).toThrow(/Invalid/);
      expect(() => validateName("-leading")).toThrow(/Invalid/);
      expect(() => validateName("trailing-")).toThrow(/Invalid/);
    });
  });

  describe("regression guards", () => {
    it("nemoclaw.js does not use execSync", () => {

      const src = fs.readFileSync(path.join(import.meta.dirname, "..", "bin", "nemoclaw.js"), "utf-8");
      const lines = src.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes("execSync") && !lines[i].includes("execFileSync")) {
          expect.unreachable(`bin/nemoclaw.js:${i + 1} uses execSync — use execFileSync instead`);
        }
      }
    });

    it("no duplicate shellQuote definitions in bin/", () => {

      const binDir = path.join(import.meta.dirname, "..", "bin");
      const files = [];
      function walk(dir) {
        for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
          if (f.isDirectory() && f.name !== "node_modules") walk(path.join(dir, f.name));
          else if (f.name.endsWith(".js")) files.push(path.join(dir, f.name));
        }
      }
      walk(binDir);

      const defs = [];
      for (const file of files) {
        const src = fs.readFileSync(file, "utf-8");
        if (src.includes("function shellQuote")) {
          defs.push(file.replace(binDir, "bin"));
        }
      }
      expect(defs.length).toBe(1);
      expect(defs[0].includes("runner")).toBeTruthy();
    });

    it("CLI rejects malicious sandbox names before shell commands (e2e)", () => {


      const canaryDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-canary-"));
      const canary = path.join(canaryDir, "executed");
      try {
        const result = spawnSync("node", [
          path.join(import.meta.dirname, "..", "bin", "nemoclaw.js"),
          `test; touch ${canary}`,
          "connect",
        ], {
          encoding: "utf-8",
          timeout: 10000,
          cwd: path.join(import.meta.dirname, ".."),
        });
        expect(result.status).not.toBe(0);
        expect(fs.existsSync(canary)).toBe(false);
      } finally {
        fs.rmSync(canaryDir, { recursive: true, force: true });
      }
    });

    it("bridge-core validates SANDBOX_NAME on startup", () => {
      const fs = require("fs");
      const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "bridge-core.js"), "utf-8");
      expect(src.includes("validateName(SANDBOX")).toBeTruthy();
      expect(src.includes("execSync")).toBe(false);
    });

    it("bridge runner uses bridge-core for sandbox relay", () => {
      const fs = require("fs");
      const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "bridge.js"), "utf-8");
      expect(src.includes("require(\"./bridge-core\")")).toBeTruthy();
      expect(src.includes("runAgentInSandbox")).toBeTruthy();
    });

    it("each messaging adapter exists and exports a function", () => {
      const fs = require("fs");
      const adaptersDir = path.join(__dirname, "..", "scripts", "adapters", "messaging");
      for (const name of ["telegram", "discord", "slack"]) {
        const adapterPath = path.join(adaptersDir, `${name}.js`);
        expect(fs.existsSync(adapterPath)).toBeTruthy();
        const src = fs.readFileSync(adapterPath, "utf-8");
        expect(src.includes("module.exports")).toBeTruthy();
      }
    });

    it("blueprint.yaml defines bridge configs for all messaging platforms", () => {
      const fs = require("fs");
      const yaml = require("js-yaml");
      const bp = yaml.load(fs.readFileSync(path.join(__dirname, "..", "nemoclaw-blueprint", "blueprint.yaml"), "utf-8"));
      const bridges = bp.components.bridges;
      for (const name of ["telegram", "discord", "slack"]) {
        expect(bridges[name]).toBeTruthy();
        expect(bridges[name].credential_env).toBeTruthy();
        expect(bridges[name].session_prefix).toBeTruthy();
        expect(bridges[name].adapter).toBeTruthy();
      }
    });

    it("blueprint bridge configs use credential_env naming consistent with inference profiles", () => {
      const fs = require("fs");
      const yaml = require("js-yaml");
      const bp = yaml.load(fs.readFileSync(path.join(__dirname, "..", "nemoclaw-blueprint", "blueprint.yaml"), "utf-8"));
      const bridges = bp.components.bridges;
      for (const [name, config] of Object.entries(bridges)) {
        expect(config.token_env).toBeFalsy();
        expect(typeof config.credential_env).toBe("string");
      }
    });

    it("slack bridge config lists SLACK_APP_TOKEN in extra_credential_env", () => {
      const fs = require("fs");
      const yaml = require("js-yaml");
      const bp = yaml.load(fs.readFileSync(path.join(__dirname, "..", "nemoclaw-blueprint", "blueprint.yaml"), "utf-8"));
      const slack = bp.components.bridges.slack;
      expect(Array.isArray(slack.extra_credential_env)).toBe(true);
      expect(slack.extra_credential_env.includes("SLACK_APP_TOKEN")).toBe(true);
    });

    it("telegram-bridge.js backwards-compat wrapper delegates to bridge.js", () => {
      const fs = require("fs");
      const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "telegram-bridge.js"), "utf-8");
      expect(src.includes("require(\"./bridge\")")).toBeTruthy();
      expect(src.includes("telegram")).toBeTruthy();
    });

    it("bridge.js loads configs from blueprint.yaml, not separate files", () => {
      const fs = require("fs");
      const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "bridge.js"), "utf-8");
      expect(src.includes("blueprint.yaml")).toBeTruthy();
      expect(src.includes("bridges/messaging")).toBe(false);
    });

    it("bridge.js logs metadata only, never raw message content", () => {
      const fs = require("fs");
      const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "bridge.js"), "utf-8");
      // Ensure log lines use length, not content
      expect(src.includes("inbound (len=")).toBeTruthy();
      expect(src.includes("response (len=")).toBeTruthy();
      // Ensure console.log calls never interpolate raw msg.text (length is ok)
      const logLines = src.split("\n").filter((l) => l.includes("console.log"));
      for (const line of logLines) {
        const hasRawText = line.includes("msg.text}") || line.includes("msg.text,") || line.includes("msg.text)");
        expect(hasRawText).toBe(false);
      }
    });

    it("onboard auto-starts bridges when messaging tokens detected", () => {
      const fs = require("fs");
      const src = fs.readFileSync(path.join(__dirname, "..", "bin", "lib", "onboard.js"), "utf-8");
      expect(src.includes("startMessagingBridges")).toBeTruthy();
      expect(src.includes("start-services.sh")).toBeTruthy();
      expect(src.includes("RISKY CHANGE")).toBeTruthy();
    });

    it("onboard passes all four credential types via getCredential pattern", () => {
      const fs = require("fs");
      const src = fs.readFileSync(path.join(__dirname, "..", "bin", "lib", "onboard.js"), "utf-8");
      for (const token of ["NVIDIA_API_KEY", "DISCORD_BOT_TOKEN", "SLACK_BOT_TOKEN", "TELEGRAM_BOT_TOKEN"]) {
        expect(src.includes(`getCredential("${token}")`)).toBeTruthy();
      }
    });
  });
});
