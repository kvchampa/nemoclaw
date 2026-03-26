#!/usr/bin/env node
// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Apply the NemoClaw config overrides shim to all OpenClaw dist files.

const fs = require("fs");
const path = require("path");

const distDir = path.join(process.argv[2] || "/usr/local/lib/node_modules/openclaw", "dist");

const SHIM = `
function _nemoClawMergeOverrides(cfg) {
\tvar _p = (typeof process !== "undefined" && process.env || {}).OPENCLAW_CONFIG_OVERRIDES_FILE;
\tif (!_p) return cfg;
\ttry {
\t\tvar _raw = require("node:fs").readFileSync(_p, "utf-8");
\t\tvar _ov = JSON.parse(_raw);
\t\tif (_ov && typeof _ov === "object") {
\t\t\tdelete _ov.gateway;
\t\t\tvar _dm = function(t, s) {
\t\t\t\tif (t && s && typeof t === "object" && typeof s === "object" && !Array.isArray(t) && !Array.isArray(s)) {
\t\t\t\t\tvar r = Object.assign({}, t);
\t\t\t\t\tfor (var k in s) { if (Object.prototype.hasOwnProperty.call(s, k)) { r[k] = (k in r) ? _dm(r[k], s[k]) : s[k]; } }
\t\t\t\t\treturn r;
\t\t\t\t}
\t\t\t\treturn s;
\t\t\t};
\t\t\treturn _dm(cfg, _ov);
\t\t}
\t} catch (e) { if (e.code !== "ENOENT") console.warn("[nemoclaw] config overrides error:", e.message); }
\treturn cfg;
}
`.trim();

const TARGET = "function resolveConfigForRead(resolvedIncludes, env) {";
const REPLACEMENT = SHIM + "\n" + TARGET + "\n\tresolvedIncludes = _nemoClawMergeOverrides(resolvedIncludes);";

let patched = 0;
for (const file of fs.readdirSync(distDir)) {
  if (!file.endsWith(".js")) continue;
  const filePath = path.join(distDir, file);
  const content = fs.readFileSync(filePath, "utf-8");
  if (!content.includes(TARGET)) continue;

  const newContent = content.replace(TARGET, REPLACEMENT);
  fs.writeFileSync(filePath, newContent);
  patched++;
  console.log(`[nemoclaw-shim] Patched: ${file}`);
}

console.log(`[nemoclaw-shim] Patched ${patched} files`);
if (patched === 0) {
  console.error("[nemoclaw-shim] WARNING: No files patched!");
  process.exit(1);
}
