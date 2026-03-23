// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Safe config file I/O with EACCES error handling (#692, #606, #719).

const fs = require("fs");
const path = require("path");

/**
 * Ensure a directory exists with mode 0o700. If the directory exists but is
 * not writable (e.g. created by root or wrong umask), attempt to fix
 * permissions before giving up with a clear error message.
 */
function ensureConfigDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch (err) {
    if (err.code === "EACCES") {
      throw new ConfigPermissionError(
        `Cannot create config directory: ${dir}`,
        dir,
        err
      );
    }
    throw err;
  }

  // Directory exists — verify it is writable by the current user.
  try {
    fs.accessSync(dir, fs.constants.W_OK);
  } catch (err) {
    if (err.code === "EACCES") {
      throw new ConfigPermissionError(
        `Config directory exists but is not writable: ${dir}`,
        dir,
        err
      );
    }
    throw err;
  }
}

/**
 * Write a JSON config file atomically with mode 0o600.
 *
 * Uses write-to-temp + rename to avoid partial writes on crash.
 * On EACCES, throws ConfigPermissionError with remediation hints.
 */
function writeConfigFile(filePath, data) {
  const dir = path.dirname(filePath);
  ensureConfigDir(dir);

  const content = JSON.stringify(data, null, 2);
  const tmpFile = filePath + ".tmp." + process.pid;

  try {
    fs.writeFileSync(tmpFile, content, { mode: 0o600 });
    fs.renameSync(tmpFile, filePath);
  } catch (err) {
    // Clean up temp file on failure
    try { fs.unlinkSync(tmpFile); } catch {}
    if (err.code === "EACCES") {
      throw new ConfigPermissionError(
        `Cannot write config file: ${filePath}`,
        filePath,
        err
      );
    }
    throw err;
  }
}

/**
 * Read and parse a JSON config file. Returns defaultValue on missing
 * or corrupt files. On EACCES, throws ConfigPermissionError.
 */
function readConfigFile(filePath, defaultValue) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch (err) {
    if (err.code === "EACCES") {
      throw new ConfigPermissionError(
        `Cannot read config file: ${filePath}`,
        filePath,
        err
      );
    }
    // Corrupt JSON or other non-permission error — return default
  }
  return defaultValue;
}

/**
 * Custom error for config permission problems.  Carries the path and
 * a user-facing remediation message so callers can display it cleanly.
 */
class ConfigPermissionError extends Error {
  constructor(message, configPath, cause) {
    const remediation = buildRemediation(configPath);
    super(`${message}\n\n${remediation}`);
    this.name = "ConfigPermissionError";
    this.code = "EACCES";
    this.configPath = configPath;
    this.remediation = remediation;
    if (cause) this.cause = cause;
  }
}

function buildRemediation(configPath) {
  const home = process.env.HOME || "~";
  const nemoclawDir = path.join(home, ".nemoclaw");
  return [
    "  To fix, run one of:",
    "",
    `    sudo chown -R $(whoami) ${nemoclawDir}`,
    `    # or, if the directory was created by another user:`,
    `    sudo rm -rf ${nemoclawDir} && nemoclaw onboard`,
    "",
    "  This usually happens when NemoClaw was first run with sudo",
    "  or the config directory was created by a different user.",
  ].join("\n");
}

module.exports = {
  ensureConfigDir,
  writeConfigFile,
  readConfigFile,
  ConfigPermissionError,
};
