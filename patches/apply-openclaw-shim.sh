#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
#
# Apply the NemoClaw config overrides shim to all OpenClaw dist files that
# contain resolveConfigForRead().  The bundler duplicates this function across
# multiple entry-point chunks, so a simple unified diff patch only catches one.
#
# The shim reads OPENCLAW_CONFIG_OVERRIDES_FILE, parses the JSON5 overlay,
# strips gateway.* keys, and deep-merges onto the frozen config.

set -euo pipefail

OPENCLAW_DIR="${1:-/usr/local/lib/node_modules/openclaw}"
DIST="${OPENCLAW_DIR}/dist"
PATCHED=0

# The shim function — injected before resolveConfigForRead
read -r -d '' SHIM <<'SHIMEOF' || true
function _nemoClawMergeOverrides(cfg) {
	var _p = (typeof process !== "undefined" && process.env || {}).OPENCLAW_CONFIG_OVERRIDES_FILE;
	if (!_p) return cfg;
	try {
		var _fs = require("node:fs");
		var _raw = _fs.readFileSync(_p, "utf-8");
		var _ov = JSON.parse(_raw);
		if (_ov && typeof _ov === "object") {
			delete _ov.gateway;
			var _dm = function(t, s) {
				if (t && s && typeof t === "object" && typeof s === "object" && !Array.isArray(t) && !Array.isArray(s)) {
					var r = Object.assign({}, t);
					for (var k in s) { if (Object.prototype.hasOwnProperty.call(s, k)) { r[k] = (k in r) ? _dm(r[k], s[k]) : s[k]; } }
					return r;
				}
				return s;
			};
			return _dm(cfg, _ov);
		}
	} catch (e) { if (e.code !== "ENOENT") console.warn("[nemoclaw] config overrides error:", e.message); }
	return cfg;
}
SHIMEOF

# Escape for sed replacement
SHIM_ESCAPED=$(printf '%s\n' "$SHIM" | sed 's/[&/\]/\\&/g; s/$/\\/')
SHIM_ESCAPED="${SHIM_ESCAPED%\\}"

for f in "${DIST}"/*.js; do
  if grep -q "function resolveConfigForRead" "$f"; then
    # Insert shim function before resolveConfigForRead
    sed -i "s/function resolveConfigForRead(resolvedIncludes, env) {/${SHIM}\nfunction resolveConfigForRead(resolvedIncludes, env) {\n\tresolvedIncludes = _nemoClawMergeOverrides(resolvedIncludes);/" "$f"
    PATCHED=$((PATCHED + 1))
    echo "[nemoclaw-shim] Patched: $(basename "$f")"
  fi
done

echo "[nemoclaw-shim] Patched ${PATCHED} files"

if [ "$PATCHED" -eq 0 ]; then
  echo "[nemoclaw-shim] WARNING: No files patched! resolveConfigForRead not found."
  exit 1
fi
