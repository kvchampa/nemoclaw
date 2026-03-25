import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const rootDockerfile = readFileSync(
  resolve(import.meta.dirname, "..", "Dockerfile"),
  "utf8",
);
const testDockerfile = readFileSync(
  resolve(import.meta.dirname, "Dockerfile.sandbox"),
  "utf8",
);

describe("Dockerfile attack-surface hardening", () => {
  for (const [label, content] of [
    ["Dockerfile", rootDockerfile],
    ["test/Dockerfile.sandbox", testDockerfile],
  ]) {
    describe(label, () => {
      it("purges gcc and compiler toolchain", () => {
        // The purge command spans multiple lines via backslash continuations
        expect(content).toMatch(/apt-get purge[^#]*gcc/s);
        expect(content).toMatch(/apt-get purge[^#]*g\+\+/s);
        expect(content).toMatch(/apt-get purge[^#]*make/s);
      });

      it("purges netcat variants", () => {
        expect(content).toMatch(/apt-get purge[^#]*netcat-openbsd/s);
        expect(content).toMatch(/apt-get purge[^#]*netcat-traditional/s);
      });

      it("does not install build-essential", () => {
        expect(content).not.toMatch(/apt-get install.*build-essential/);
      });
    });
  }
});
