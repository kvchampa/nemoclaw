// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Central port configuration — override via environment variables.

/**
 * Read an environment variable as a port number, falling back to a default.
 *
 * Validates that the value contains only digits and falls within the
 * non-privileged port range (1024–65535).
 *
 * @param {string} envVar  - Name of the environment variable to read.
 * @param {number} fallback - Default port when the variable is unset or empty.
 * @returns {number} The resolved port number.
 * @throws {Error} If the value is not a valid port in range.
 */
function parsePort(envVar, fallback) {
  const raw = process.env[envVar];
  if (raw === undefined || raw === "") return fallback;
  const trimmed = String(raw).trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(
      `Invalid port: ${envVar}="${raw}" — must be an integer between 1024 and 65535`
    );
  }
  const parsed = Number(trimmed);
  if (parsed < 1024 || parsed > 65535) {
    throw new Error(
      `Invalid port: ${envVar}="${raw}" — must be an integer between 1024 and 65535`
    );
  }
  return parsed;
}

/** @type {number} Dashboard UI port (default 18789, override via NEMOCLAW_DASHBOARD_PORT). */
const DASHBOARD_PORT = parsePort("NEMOCLAW_DASHBOARD_PORT", 18789);
/** @type {number} OpenShell gateway port (default 8081, override via NEMOCLAW_GATEWAY_PORT). */
const GATEWAY_PORT = parsePort("NEMOCLAW_GATEWAY_PORT", 8081);
/** @type {number} vLLM inference port (default 8009, override via NEMOCLAW_VLLM_PORT). */
const VLLM_PORT = parsePort("NEMOCLAW_VLLM_PORT", 8009);
/** @type {number} Ollama inference port (default 11434, override via NEMOCLAW_OLLAMA_PORT). */
const OLLAMA_PORT = parsePort("NEMOCLAW_OLLAMA_PORT", 11434);

module.exports = { DASHBOARD_PORT, GATEWAY_PORT, VLLM_PORT, OLLAMA_PORT };
