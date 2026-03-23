// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, beforeEach, afterEach, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Redirect HOME to a temp dir so tests don't touch real ~/.nemoclaw
const origHome = process.env.HOME;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-configio-"));
process.env.HOME = tmpDir;

import {
  ensureConfigDir,
  writeConfigFile,
  readConfigFile,
  ConfigPermissionError,
} from "../bin/lib/config-io.js";

const testDir = path.join(tmpDir, ".nemoclaw");
const testFile = path.join(testDir, "test-config.json");

beforeEach(() => {
  // Clean up test dir between tests
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
});

afterEach(() => {
  // Restore writable permissions for cleanup
  try {
    if (fs.existsSync(testDir)) {
      fs.chmodSync(testDir, 0o700);
    }
  } catch {}
});

describe("config-io", () => {
  describe("ensureConfigDir", () => {
    it("creates directory with mode 0700", () => {
      ensureConfigDir(testDir);
      const stat = fs.statSync(testDir);
      expect(stat.isDirectory()).toBe(true);
      expect(stat.mode & 0o777).toBe(0o700);
    });

    it("succeeds when directory already exists", () => {
      fs.mkdirSync(testDir, { recursive: true, mode: 0o700 });
      expect(() => ensureConfigDir(testDir)).not.toThrow();
    });

    it("throws ConfigPermissionError when directory is not writable", () => {
      fs.mkdirSync(testDir, { recursive: true, mode: 0o700 });
      fs.chmodSync(testDir, 0o500); // read + execute only
      const subDir = path.join(testDir, "sub");
      expect(() => ensureConfigDir(subDir)).toThrow(ConfigPermissionError);
      try {
        ensureConfigDir(subDir);
      } catch (err) {
        expect(err.code).toBe("EACCES");
        expect(err.remediation).toContain("chown");
      }
    });

    it("throws ConfigPermissionError when existing dir is read-only", () => {
      fs.mkdirSync(testDir, { recursive: true, mode: 0o500 });
      expect(() => ensureConfigDir(testDir)).toThrow(ConfigPermissionError);
      try {
        ensureConfigDir(testDir);
      } catch (err) {
        expect(err.message).toContain("not writable");
      }
    });
  });

  describe("writeConfigFile", () => {
    it("writes JSON with mode 0600", () => {
      writeConfigFile(testFile, { key: "value" });
      const stat = fs.statSync(testFile);
      expect(stat.mode & 0o777).toBe(0o600);
      const data = JSON.parse(fs.readFileSync(testFile, "utf-8"));
      expect(data).toEqual({ key: "value" });
    });

    it("creates parent directory if missing", () => {
      const nested = path.join(testDir, "deep", "config.json");
      writeConfigFile(nested, { deep: true });
      expect(fs.existsSync(nested)).toBe(true);
    });

    it("overwrites existing file atomically", () => {
      writeConfigFile(testFile, { version: 1 });
      writeConfigFile(testFile, { version: 2 });
      const data = JSON.parse(fs.readFileSync(testFile, "utf-8"));
      expect(data.version).toBe(2);
    });

    it("does not leave temp file on success", () => {
      writeConfigFile(testFile, { clean: true });
      const siblings = fs.readdirSync(testDir);
      const tmpFiles = siblings.filter((f) => f.includes(".tmp."));
      expect(tmpFiles.length).toBe(0);
    });

    it("throws ConfigPermissionError on EACCES", () => {
      fs.mkdirSync(testDir, { recursive: true, mode: 0o500 });
      expect(() => writeConfigFile(testFile, { fail: true })).toThrow(ConfigPermissionError);
      try {
        writeConfigFile(testFile, { fail: true });
      } catch (err) {
        expect(err.code).toBe("EACCES");
      }
    });
  });

  describe("readConfigFile", () => {
    it("reads valid JSON", () => {
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(testFile, '{"hello":"world"}');
      const data = readConfigFile(testFile, {});
      expect(data).toEqual({ hello: "world" });
    });

    it("returns default for missing file", () => {
      const data = readConfigFile(testFile, { empty: true });
      expect(data).toEqual({ empty: true });
    });

    it("returns default for corrupt JSON", () => {
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(testFile, "NOT VALID JSON");
      const data = readConfigFile(testFile, []);
      expect(data).toEqual([]);
    });

    it("throws ConfigPermissionError on EACCES", () => {
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(testFile, '{"secret":true}', { mode: 0o000 });
      expect(() => readConfigFile(testFile, {})).toThrow(ConfigPermissionError);
      try {
        readConfigFile(testFile, {});
      } catch (err) {
        expect(err.message).toContain("Cannot read");
      }
    });
  });

  describe("ConfigPermissionError", () => {
    it("includes remediation in message", () => {
      const err = new ConfigPermissionError("test", "/home/user/.nemoclaw/x");
      expect(err.message).toContain("chown");
      expect(err.message).toContain("nemoclaw onboard");
      expect(err.name).toBe("ConfigPermissionError");
      expect(err.code).toBe("EACCES");
    });

    it("preserves cause", () => {
      const cause = new Error("original");
      const err = new ConfigPermissionError("test", "/tmp/x", cause);
      expect(err.cause).toBe(cause);
    });
  });
});
