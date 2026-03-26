// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Multi-sandbox registry at ~/.nemoclaw/sandboxes.json

const fs = require("fs");
const path = require("path");

const REGISTRY_FILE = path.join(process.env.HOME || "/tmp", ".nemoclaw", "sandboxes.json");

/** Load the sandbox registry from disk, returning an empty state if absent or corrupt. */
function load() {
  try {
    if (fs.existsSync(REGISTRY_FILE)) {
      return JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf-8"));
    }
  } catch {}
  return { sandboxes: {}, defaultSandbox: null };
}

/** Persist the given registry state to ~/.nemoclaw/sandboxes.json. */
function save(data) {
  const dir = path.dirname(REGISTRY_FILE);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

/** Return the sandbox entry for the given name, or null if not found. */
function getSandbox(name) {
  const data = load();
  return data.sandboxes[name] || null;
}

/** Return the name of the default sandbox, falling back to the first registered one. */
function getDefault() {
  const data = load();
  if (data.defaultSandbox && data.sandboxes[data.defaultSandbox]) {
    return data.defaultSandbox;
  }
  // Fall back to first sandbox if default is missing
  const names = Object.keys(data.sandboxes);
  return names.length > 0 ? names[0] : null;
}

/** Register a new sandbox in the registry, setting it as default if none exists. */
function registerSandbox(entry) {
  const data = load();
  data.sandboxes[entry.name] = {
    name: entry.name,
    createdAt: entry.createdAt || new Date().toISOString(),
    model: entry.model || null,
    nimContainer: entry.nimContainer || null,
    provider: entry.provider || null,
    gpuEnabled: entry.gpuEnabled || false,
    policies: entry.policies || [],
  };
  if (!data.defaultSandbox) {
    data.defaultSandbox = entry.name;
  }
  save(data);
}

/** Merge updates into an existing sandbox entry. Returns false if the sandbox does not exist. */
function updateSandbox(name, updates) {
  const data = load();
  if (!data.sandboxes[name]) return false;
  Object.assign(data.sandboxes[name], updates);
  save(data);
  return true;
}

/** Remove a sandbox by name and reassign the default if necessary. */
function removeSandbox(name) {
  const data = load();
  if (!data.sandboxes[name]) return false;
  delete data.sandboxes[name];
  if (data.defaultSandbox === name) {
    const remaining = Object.keys(data.sandboxes);
    data.defaultSandbox = remaining.length > 0 ? remaining[0] : null;
  }
  save(data);
  return true;
}

/** List all registered sandboxes and the current default. */
function listSandboxes() {
  const data = load();
  return {
    sandboxes: Object.values(data.sandboxes),
    defaultSandbox: data.defaultSandbox,
  };
}

/** Set the named sandbox as the default. Returns false if the sandbox does not exist. */
function setDefault(name) {
  const data = load();
  if (!data.sandboxes[name]) return false;
  data.defaultSandbox = name;
  save(data);
  return true;
}

/** Reset the registry to an empty state, removing all sandboxes and the default selection. */
function clearAll() {
  save({ sandboxes: {}, defaultSandbox: null });
}

module.exports = {
  clearAll,
  load,
  save,
  getSandbox,
  getDefault,
  registerSandbox,
  updateSandbox,
  removeSandbox,
  listSandboxes,
  setDefault,
};
