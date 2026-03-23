// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

const { execSync, spawnSync } = require("child_process");
const path = require("path");
const { detectDockerHost } = require("./platform");

const ROOT = path.resolve(__dirname, "..", "..");
const SCRIPTS = path.join(ROOT, "scripts");

/**
 * Redact known secret patterns from a string to prevent credential leaks
 * in logs, error messages, and terminal output.
 *
 * Matches:
 *  - Environment-style assignments: NVIDIA_API_KEY=sk-... → NVIDIA_API_KEY=<REDACTED>
 *  - NVIDIA API key prefix:         nvapi-Abc123...       → <REDACTED>
 *  - GitHub PAT prefix:             ghp_Abc123...         → <REDACTED>
 *  - Bearer tokens:                 Bearer eyJhb...       → Bearer <REDACTED>
 */
const SECRET_PATTERNS = [
  { re: /(NVIDIA_API_KEY|API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|_KEY)=\S+/gi, replacement: "$1=<REDACTED>" },
  { re: /nvapi-[A-Za-z0-9_-]{10,}/g, replacement: "<REDACTED>" },
  { re: /ghp_[A-Za-z0-9]{30,}/g, replacement: "<REDACTED>" },
  { re: /(Bearer )\S+/gi, replacement: "$1<REDACTED>" },
];

function redactSecrets(str) {
  if (typeof str !== "string") return str;
  let result = str;
  for (const { re, replacement } of SECRET_PATTERNS) {
    re.lastIndex = 0;
    result = result.replace(re, replacement);
  }
  return result;
}

const dockerHost = detectDockerHost();
if (dockerHost) {
  process.env.DOCKER_HOST = dockerHost.dockerHost;
}

function run(cmd, opts = {}) {
  const stdio = opts.stdio ?? ["ignore", "inherit", "inherit"];
  const result = spawnSync("bash", ["-c", cmd], {
    ...opts,
    stdio,
    cwd: ROOT,
    env: { ...process.env, ...opts.env },
  });
  if (result.status !== 0 && !opts.ignoreError) {
    console.error(`  Command failed (exit ${result.status}): ${redactSecrets(cmd.slice(0, 80))}`);
    process.exit(result.status || 1);
  }
  return result;
}

function runInteractive(cmd, opts = {}) {
  const stdio = opts.stdio ?? "inherit";
  const result = spawnSync("bash", ["-c", cmd], {
    ...opts,
    stdio,
    cwd: ROOT,
    env: { ...process.env, ...opts.env },
  });
  if (result.status !== 0 && !opts.ignoreError) {
    console.error(`  Command failed (exit ${result.status}): ${redactSecrets(cmd.slice(0, 80))}`);
    process.exit(result.status || 1);
  }
  return result;
}

function runCapture(cmd, opts = {}) {
  try {
    return execSync(cmd, {
      ...opts,
      encoding: "utf-8",
      cwd: ROOT,
      env: { ...process.env, ...opts.env },
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    if (opts.ignoreError) return "";
    throw err;
  }
}

/**
 * Shell-quote a value for safe interpolation into bash -c strings.
 * Wraps in single quotes and escapes embedded single quotes.
 */
function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * Validate a name (sandbox, instance, container) against RFC 1123 label rules.
 * Rejects shell metacharacters, path traversal, and empty/overlength names.
 */
function validateName(name, label = "name") {
  if (!name || typeof name !== "string") {
    throw new Error(`${label} is required`);
  }
  if (name.length > 63) {
    throw new Error(`${label} too long (max 63 chars): '${name.slice(0, 20)}...'`);
  }
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name)) {
    throw new Error(
      `Invalid ${label}: '${name}'. Must be lowercase alphanumeric with optional internal hyphens.`
    );
  }
  return name;
}

module.exports = { ROOT, SCRIPTS, run, runCapture, runInteractive, shellQuote, validateName, redactSecrets };
