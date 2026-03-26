// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import assert from "assert";
import { describe, it } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { loadAllowList, OVERRIDES_PATH } = require("../bin/lib/config-set");

describe("config-set", () => {
  describe("loadAllowList", () => {
    it("returns a Set", () => {
      const allowList = loadAllowList();
      assert.ok(allowList instanceof Set);
    });

    it("does NOT include gateway paths", () => {
      const allowList = loadAllowList();
      for (const key of allowList) {
        assert.ok(!key.startsWith("gateway."), `allow-list must not contain gateway.* keys, found: ${key}`);
      }
    });
  });

  describe("OVERRIDES_PATH", () => {
    it("points to writable partition", () => {
      assert.ok(OVERRIDES_PATH.startsWith("/sandbox/.openclaw-data/"));
    });

    it("is a json5 file", () => {
      assert.ok(OVERRIDES_PATH.endsWith(".json5"));
    });
  });
});
