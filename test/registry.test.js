// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";

// Use a temp dir so tests don't touch real ~/.nemoclaw.
// HOME must be set before loading registry (it reads HOME at require time),
// so we use createRequire instead of a static import.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-test-"));
process.env.HOME = tmpDir;

const require = createRequire(import.meta.url);
const registry = require("../bin/lib/registry");

const regFile = path.join(tmpDir, ".nemoclaw", "sandboxes.json");

beforeEach(() => {
  if (fs.existsSync(regFile)) fs.unlinkSync(regFile);
});

describe("registry", () => {
  it("starts empty", () => {
    const { sandboxes, defaultSandbox } = registry.listSandboxes();
    expect(sandboxes.length).toBe(0);
    expect(defaultSandbox).toBe(null);
  });

  it("registers a sandbox and sets it as default", () => {
    registry.registerSandbox({ name: "alpha", model: "test-model", provider: "nvidia-nim" });
    const sb = registry.getSandbox("alpha");
    expect(sb.name).toBe("alpha");
    expect(sb.model).toBe("test-model");
    expect(registry.getDefault()).toBe("alpha");
  });

  it("first registered becomes default", () => {
    registry.registerSandbox({ name: "first" });
    registry.registerSandbox({ name: "second" });
    expect(registry.getDefault()).toBe("first");
  });

  it("setDefault changes the default", () => {
    registry.registerSandbox({ name: "a" });
    registry.registerSandbox({ name: "b" });
    registry.setDefault("b");
    expect(registry.getDefault()).toBe("b");
  });

  it("setDefault returns false for nonexistent sandbox", () => {
    expect(registry.setDefault("nope")).toBe(false);
  });

  it("updateSandbox modifies fields", () => {
    registry.registerSandbox({ name: "up" });
    registry.updateSandbox("up", { policies: ["pypi", "npm"], model: "new-model" });
    const sb = registry.getSandbox("up");
    expect(sb.policies).toEqual(["pypi", "npm"]);
    expect(sb.model).toBe("new-model");
  });

  it("registerSandbox and updateSandbox store nimPort", () => {
    registry.registerSandbox({ name: "nim-sb", nimPort: 9000 });
    expect(registry.getSandbox("nim-sb").nimPort).toBe(9000);
    registry.updateSandbox("nim-sb", { nimPort: 9001 });
    expect(registry.getSandbox("nim-sb").nimPort).toBe(9001);
  });

  it("updateSandbox returns false for nonexistent sandbox", () => {
    expect(registry.updateSandbox("nope", {})).toBe(false);
  });

  it("removeSandbox deletes and shifts default", () => {
    registry.registerSandbox({ name: "x" });
    registry.registerSandbox({ name: "y" });
    registry.setDefault("x");
    registry.removeSandbox("x");
    expect(registry.getSandbox("x")).toBe(null);
    expect(registry.getDefault()).toBe("y");
  });

  it("removeSandbox last sandbox sets default to null", () => {
    registry.registerSandbox({ name: "only" });
    registry.removeSandbox("only");
    expect(registry.getDefault()).toBe(null);
    expect(registry.listSandboxes().sandboxes.length).toBe(0);
  });

  it("removeSandbox returns false for nonexistent", () => {
    expect(registry.removeSandbox("nope")).toBe(false);
  });

  it("getSandbox returns null for nonexistent", () => {
    expect(registry.getSandbox("nope")).toBe(null);
  });

  it("persists to disk and survives reload", () => {
    registry.registerSandbox({ name: "persist", model: "m1" });
    // Read file directly
    const data = JSON.parse(fs.readFileSync(regFile, "utf-8"));
    expect(data.sandboxes.persist.model).toBe("m1");
    expect(data.defaultSandbox).toBe("persist");
  });

  it("handles corrupt registry file gracefully", () => {
    fs.mkdirSync(path.dirname(regFile), { recursive: true });
    fs.writeFileSync(regFile, "NOT JSON");
    // Should not throw, returns empty
    const { sandboxes } = registry.listSandboxes();
    expect(sandboxes.length).toBe(0);
  });
});

describe("registry + nim port", () => {
  const nim = require("../bin/lib/nim");

  it("getNimPortForSandbox falls back to default for invalid stored nimPort values", () => {
    registry.registerSandbox({ name: "bad-port-zero", nimPort: 0 });
    registry.registerSandbox({ name: "bad-port-high", nimPort: 70000 });
    registry.registerSandbox({ name: "bad-port-text", nimPort: "abc" });
    expect(nim.getNimPortForSandbox("bad-port-zero")).toBe(nim.DEFAULT_NIM_PORT);
    expect(nim.getNimPortForSandbox("bad-port-high")).toBe(nim.DEFAULT_NIM_PORT);
    expect(nim.getNimPortForSandbox("bad-port-text")).toBe(nim.DEFAULT_NIM_PORT);
  });

  it("getNimPortForSandbox accepts valid boundary ports", () => {
    registry.registerSandbox({ name: "port-min", nimPort: 1 });
    registry.registerSandbox({ name: "port-max", nimPort: 65535 });
    expect(nim.getNimPortForSandbox("port-min")).toBe(1);
    expect(nim.getNimPortForSandbox("port-max")).toBe(65535);
  });

  it("getNimPortForSandbox returns default when sandbox has no nimPort", () => {
    registry.registerSandbox({ name: "no-port" });
    expect(nim.getNimPortForSandbox("no-port")).toBe(nim.DEFAULT_NIM_PORT);
  });

  it("getNimPortForSandbox returns stored nimPort", () => {
    registry.registerSandbox({ name: "with-port", nimPort: 9000 });
    expect(nim.getNimPortForSandbox("with-port")).toBe(9000);
  });

  it("getNimPortForSandbox returns default for nonexistent sandbox", () => {
    expect(nim.getNimPortForSandbox("nonexistent-xyz")).toBe(nim.DEFAULT_NIM_PORT);
  });
});
