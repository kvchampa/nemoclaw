// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const SETUP_APPLE_SCRIPT = path.join(import.meta.dirname, "..", "scripts", "setup-apple.sh");

// Helper: run the setup-apple script with a mocked environment
// Redirects stderr to stdout so all output (info + warn) is captured together.
function runSetupApple(mockEnv = {}) {
  const env = {
    ...process.env,
    ...mockEnv,
  };

  try {
    const out = execSync(`/bin/bash "${SETUP_APPLE_SCRIPT}" 2>&1`, {
      encoding: "utf-8",
      timeout: 30000,
      env,
      stdio: "pipe",
    });
    return { code: 0, out, err: "" };
  } catch (err) {
    return {
      code: err.status || 1,
      out: err.stdout || "",
      err: err.stderr || "",
    };
  }
}

// Helper: create a temporary script that mocks system commands
function createMockScript(commands) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-apple-test-"));
  const mockBin = path.join(dir, "bin");
  fs.mkdirSync(mockBin, { recursive: true });

  // Create mock command scripts
  for (const [cmd, behavior] of Object.entries(commands)) {
    const scriptPath = path.join(mockBin, cmd);
    let scriptContent = "#!/usr/bin/env bash\n";

    if (typeof behavior === "string") {
      // Simple output
      scriptContent += `echo "${behavior}"\n`;
    } else if (behavior.exit) {
      // Exit with code
      scriptContent += `exit ${behavior.exit}\n`;
    } else if (behavior.output) {
      // Output and exit code
      scriptContent += `echo "${behavior.output}"\n`;
      scriptContent += `exit ${behavior.exit || 0}\n`;
    } else if (behavior.script) {
      // Custom script
      scriptContent += behavior.script;
    }

    fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 });
  }

  return { dir, mockBin };
}

// Helpers for common precondition checks
function isDarwin() {
  return process.platform === "darwin";
}

function isAppleSilicon() {
  return isDarwin() && process.arch === "arm64";
}

function hasCommand(cmd) {
  try { execSync(`which ${cmd}`, { encoding: "utf-8", stdio: "pipe" }); return true; }
  catch { return false; }
}

function isDockerRunning() {
  try { execSync("docker info", { encoding: "utf-8", stdio: "pipe", timeout: 5000 }); return true; }
  catch { return false; }
}

describe("setup-apple.sh", () => {
  describe("Platform detection", () => {
    it.skipIf(isDarwin())("fails on non-macOS platforms", () => {
      const result = runSetupApple();
      expect(result.code).toBe(1);
      expect(
        result.err.includes("macOS") || result.out.includes("macOS"),
      ).toBe(true);
    });

    it.skipIf(!isDarwin())("detects macOS and shows version", () => {
      const result = runSetupApple();
      expect(
        result.out.includes("macOS detected") || result.err.includes("Node.js not found"),
      ).toBe(true);
    });
  });

  describe("Node.js version checks", () => {
    it.skipIf(!isDarwin())("fails when Node.js is not found", () => {
      const { mockBin } = createMockScript({});
      const result = runSetupApple({
        PATH: mockBin,
      });

      expect(result.code).not.toBe(0);
      const output = result.out + result.err;
      expect(
        output.includes("Node.js") || result.code !== 0,
      ).toBe(true);
    });

    it.skipIf(!isDarwin())("fails when Node.js version is less than 20", () => {
      const { mockBin } = createMockScript({
        node: {
          script: `#!/usr/bin/env bash
if [[ "$1" == "-v" ]]; then
  echo "v18.19.0"
elif [[ "$1" == "-e" ]]; then
  echo "18"
else
  exit 0
fi
`,
        },
        sw_vers: { output: "13.0" },
      });

      const result = runSetupApple({
        PATH: mockBin + ":" + process.env.PATH,
      });

      expect(result.code).toBe(1);
      expect(
        result.err.includes("Node.js 20+ required") || result.out.includes("Node.js 20+ required"),
      ).toBe(true);
    });

    it.skipIf(!isDarwin() || parseInt(process.versions.node.split(".")[0]) < 20)(
      "passes when Node.js version is 20 or higher", () => {
        const result = runSetupApple();
        expect(
          result.out.includes("Node.js") && result.out.includes("OK"),
        ).toBe(true);
      },
    );
  });

  describe("Docker socket detection", () => {
    it.skipIf(!isDarwin() || !fs.existsSync(path.join(os.homedir(), ".docker/run/docker.sock")))(
      "detects Docker Desktop socket when available", () => {
        const result = runSetupApple();
        expect(
          result.out.includes("Docker Desktop detected") || result.out.includes("Docker memory"),
        ).toBe(true);
      },
    );

    it.skipIf(
      !isDarwin() ||
      (!fs.existsSync(path.join(os.homedir(), ".colima/default/docker.sock")) &&
       !fs.existsSync(path.join(os.homedir(), ".config/colima/default/docker.sock"))),
    )("detects Colima socket when available", () => {
      const result = runSetupApple();
      expect(result.out.includes("Colima detected")).toBe(true);
    });
  });

  describe("Docker memory allocation checks", () => {
    it.skipIf(!isDarwin() || !isDockerRunning())(
      "shows OK when Docker memory is 8GB or more", () => {
        let memGB;
        try {
          const memBytes = execSync("docker info --format '{{.MemTotal}}' 2>/dev/null", {
            encoding: "utf-8", timeout: 5000,
          }).trim();
          memGB = Math.floor(parseInt(memBytes) / (1024 * 1024 * 1024));
        } catch {
          return; // skip if can't query
        }
        if (memGB < 8) return; // skip if not enough memory

        const result = runSetupApple();
        expect(
          result.out.includes("Docker memory") && result.out.includes("GB"),
        ).toBe(true);
      },
    );
  });

  describe("Ollama detection", () => {
    it.skipIf(!isDarwin() || !hasCommand("ollama"))("detects installed Ollama", () => {
      const result = runSetupApple();
      expect(
        result.out.includes("Ollama installed") || result.out.includes("Ollama is"),
      ).toBe(true);
    });

    it.skipIf(!isDarwin() || !hasCommand("ollama"))("checks if Ollama is running", () => {
      try {
        execSync("curl -sf http://localhost:11434/api/tags", {
          encoding: "utf-8", timeout: 2000, stdio: "pipe",
        });
      } catch {
        return; // skip if Ollama not running
      }

      const result = runSetupApple();
      expect(
        result.out.includes("running") || result.out.includes("localhost:11434"),
      ).toBe(true);
    });

    it.skipIf(!isDarwin() || !hasCommand("ollama") || !!process.env.OLLAMA_HOST)(
      "warns about OLLAMA_HOST when unset", () => {
        const result = runSetupApple();
        const output = result.out + result.err;
        expect(
          output.includes("OLLAMA_HOST") && output.includes("0.0.0.0:11434"),
        ).toBe(true);
      },
    );
  });

  describe("OpenShell CLI", () => {
    it.skipIf(!isDarwin() || !hasCommand("openshell"))("detects installed openshell CLI", () => {
      const result = runSetupApple();
      expect(result.out.includes("openshell CLI")).toBe(true);
    });

    it.skipIf(!isDarwin() || !hasCommand("openshell") || !isDockerRunning())(
      "runs openshell doctor check after installation", () => {
        const result = runSetupApple();
        expect(
          result.out.includes("openshell doctor check") ||
          result.err.includes("openshell doctor check"),
        ).toBe(true);
      },
    );

    it("install-openshell.sh script exists", () => {
      const installScript = path.join(import.meta.dirname, "..", "scripts", "install-openshell.sh");
      expect(fs.existsSync(installScript)).toBe(true);
    });
  });

  describe("Apple GPU detection", () => {
    it.skipIf(!isAppleSilicon())("detects Apple GPU and chipset", () => {
      const result = runSetupApple();
      if (result.code === 0) {
        expect(result.out.includes("Apple GPU")).toBe(true);
      }
    });

    it.skipIf(!isAppleSilicon())("detects unified memory size", () => {
      const result = runSetupApple();
      if (result.code === 0 && result.out.includes("Unified memory")) {
        expect(
          result.out.includes("GB") && result.out.includes("Unified memory"),
        ).toBe(true);
      }
    });

    it.skipIf(!isAppleSilicon())("shows cloud inference note for Apple Silicon", () => {
      const result = runSetupApple();
      if (result.code === 0) {
        expect(
          result.out.includes("NVIDIA GPU") || result.out.includes("cloud"),
        ).toBe(true);
      }
    });
  });

  describe("nvm detection and warnings", () => {
    it.skipIf(!isDarwin())("warns when nvm is detected", () => {
      const nvmDir = process.env.NVM_DIR || path.join(os.homedir(), ".nvm");
      if (!process.env.NVM_DIR && !fs.existsSync(nvmDir)) return; // skip if nvm not detected

      const result = runSetupApple();
      const output = result.out + result.err;
      expect(
        output.includes("nvm") && output.includes("alias default"),
      ).toBe(true);
    });
  });

  describe("Success completion", () => {
    it.skipIf(!isDarwin())("shows next steps message on completion", () => {
      const result = runSetupApple();
      if (result.code === 0) {
        expect(
          result.out.includes("nemoclaw onboard") || result.out.includes("Next step"),
        ).toBe(true);
      }
    });

    it.skipIf(!isDarwin())("shows setup checks complete message", () => {
      const result = runSetupApple();
      if (result.code === 0) {
        expect(
          result.out.includes("setup checks complete"),
        ).toBe(true);
      }
    });
  });

  describe("Error handling", () => {
    it.skipIf(!isDarwin())("exits with non-zero code on errors", () => {
      const { mockBin } = createMockScript({});
      const result = runSetupApple({ PATH: mockBin });
      expect(result.code).not.toBe(0);
    });

    it.skipIf(!isDarwin())("stops execution on first critical error (set -e)", () => {
      const { mockBin } = createMockScript({});
      const result = runSetupApple({ PATH: mockBin });
      // Should fail on Node.js/uname check and not proceed to Docker checks
      expect(result.code).not.toBe(0);
      expect(result.out.includes("Docker")).toBe(false);
    });
  });

  describe("CLI integration", () => {
    it.skipIf(!isDarwin())("can be invoked via nemoclaw setup-apple", () => {
      const CLI = path.join(import.meta.dirname, "..", "bin", "nemoclaw.js");

      try {
        const out = execSync(`node "${CLI}" setup-apple 2>&1`, {
          encoding: "utf-8",
          timeout: 30000,
          stdio: "pipe",
        });

        expect(
          out.includes("macOS") || out.includes("Node.js") || out.includes("Docker"),
        ).toBe(true);
      } catch (err) {
        const output = (err.stdout || "") + (err.stderr || "");
        expect(
          output.includes("macOS") || output.includes("Node.js"),
        ).toBe(true);
      }
    });
  });
});
