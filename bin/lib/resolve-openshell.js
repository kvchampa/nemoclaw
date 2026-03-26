// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

const { execSync, execFileSync } = require("child_process");
const fs = require("fs");

/**
 * Resolve the openshell binary path.
 *
 * Checks `command -v` first (must return an absolute path to prevent alias
 * injection), then falls back to common installation directories.
 *
 * @param {object} [opts] DI overrides for testing
 * @param {string|null} [opts.commandVResult] Mock result (undefined = run real command)
 * @param {function} [opts.checkExecutable] (path) => boolean
 * @param {string} [opts.home] HOME override
 * @returns {string|null} Absolute path to openshell, or null if not found
 */
/**
 * Verify if the binary is the OpenShell Rust CLI (and not a shadowing NPM package).
 * @param {string} path Absolute path to binary
 * @returns {boolean}
 */
function isRustCli(path) {
  try {
    const output = execFileSync(path, ["-V"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 2000,
    }).trim();
    // Rust version string: "openshell 0.1.0"
    return /^openshell\s+[0-9]+\.[0-9]+\.[0-9]+/i.test(output);
  } catch {
    return false;
  }
}

function resolveOpenshell(opts = {}) {
  const home = opts.home ?? process.env.HOME;

  // Step 1: command -v (check if it is the Rust CLI)
  if (opts.commandVResult === undefined) {
    try {
      const found = execSync("command -v openshell", { encoding: "utf-8" }).trim();
      if (found.startsWith("/") && isRustCli(found)) return found;
    } catch { /* ignored */ }
  } else if (opts.commandVResult && opts.commandVResult.startsWith("/") && isRustCli(opts.commandVResult)) {
    return opts.commandVResult;
  }

  // Step 2: fallback candidates (verify they are the Rust CLI)
  const checkExecutable = opts.checkExecutable || ((p) => {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return isRustCli(p);
    } catch {
      return false;
    }
  });

  const candidates = [
    ...(home && home.startsWith("/") ? [`${home}/.local/bin/openshell`] : []),
    "/usr/local/bin/openshell",
    "/usr/bin/openshell",
  ];
  for (const p of candidates) {
    if (checkExecutable(p)) return p;
  }

  return null;
}

module.exports = { resolveOpenshell };
