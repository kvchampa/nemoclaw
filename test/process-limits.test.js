import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const startScript = readFileSync(
  resolve(import.meta.dirname, "..", "scripts", "nemoclaw-start.sh"),
  "utf8",
);

const policyYaml = readFileSync(
  resolve(
    import.meta.dirname,
    "..",
    "nemoclaw-blueprint",
    "policies",
    "openclaw-sandbox.yaml",
  ),
  "utf8",
);

const onboardJs = readFileSync(
  resolve(import.meta.dirname, "..", "bin", "lib", "onboard.js"),
  "utf8",
);

describe("fork bomb protection (process limits)", () => {
  describe("nemoclaw-start.sh", () => {
    it("checks current ulimit -u value", () => {
      expect(startScript).toContain("ulimit -u");
    });

    it("sets ulimit -u 512 when unlimited", () => {
      expect(startScript).toMatch(/ulimit -u 512/);
    });

    it("only overrides when the current limit is unlimited", () => {
      expect(startScript).toMatch(
        /if \[ "\$current_nproc" = "unlimited" \]/,
      );
    });

    it("references issue #809", () => {
      expect(startScript).toContain(
        "https://github.com/NVIDIA/NemoClaw/issues/809",
      );
    });
  });

  describe("sandbox policy YAML", () => {
    it("documents that pids-limit must be set at container runtime level", () => {
      expect(policyYaml).toContain("fork bomb protection");
    });

    it("references issue #809", () => {
      expect(policyYaml).toContain(
        "https://github.com/NVIDIA/NemoClaw/issues/809",
      );
    });
  });

  describe("onboard.js", () => {
    it("applies docker update --pids-limit after sandbox creation", () => {
      expect(onboardJs).toMatch(/docker update --pids-limit/);
    });

    it("uses NEMOCLAW_PIDS_LIMIT env var with 512 default", () => {
      expect(onboardJs).toContain('NEMOCLAW_PIDS_LIMIT');
      expect(onboardJs).toMatch(/\|\|\s*"512"/);
    });
  });
});
