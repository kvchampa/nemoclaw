// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
//
// MCP bridge: manage stdio-to-HTTP proxies that expose host-side MCP servers
// to sandboxes via egress policies and host.docker.internal.

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { ROOT, SCRIPTS, run, runCapture } = require("./runner");
const { resolveOpenshell } = require("./resolve-openshell");
const registry = require("./registry");

const MCP_PORT_START = 3100;
const MCP_PORT_END = 3199;
const PROXY_SCRIPT = path.join(SCRIPTS, "mcp-proxy.js");
const VALID_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const VALID_ENV_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MCP_HOST = "host.docker.internal";

function validateName(name) {
  if (!name || !VALID_NAME_RE.test(name) || name.length > 64) {
    console.error(`  Invalid server name '${String(name).slice(0, 64)}'.`);
    console.error(
      "  Names must start with a letter and contain only letters, digits, hyphens, and underscores.",
    );
    process.exit(1);
  }
}

function validateEnvName(name) {
  if (!name || !VALID_ENV_RE.test(name) || name.length > 128) {
    console.error(
      `  Invalid environment variable name '${String(name).slice(0, 128)}'.`,
    );
    console.error(
      "  Names must match [A-Za-z_][A-Za-z0-9_]* (e.g., GITHUB_TOKEN).",
    );
    process.exit(1);
  }
}

// ── PID file helpers ────────────────────────────────────────────

function pidDir(sandboxName) {
  return `/tmp/nemoclaw-services-${sandboxName}`;
}

function pidFile(sandboxName, serverName) {
  return path.join(pidDir(sandboxName), `mcp-${serverName}.pid`);
}

function writePidFile(filePath, pid) {
  // Store PID and start time to detect recycled PIDs
  fs.writeFileSync(filePath, `${pid}\n${Date.now()}`);
}

function isRunning(pidPath) {
  try {
    const content = fs.readFileSync(pidPath, "utf-8").trim();
    const lines = content.split("\n");
    const pid = parseInt(lines[0], 10);
    const startTime = parseInt(lines[1], 10) || 0;
    process.kill(pid, 0); // probe — throws if not running
    // If the PID file is older than 30 days, assume recycled
    if (startTime && Date.now() - startTime > 30 * 24 * 60 * 60 * 1000) {
      return false;
    }
    return pid;
  } catch {
    return false;
  }
}

// ── Port management ─────────────────────────────────────────────

function getAllUsedPorts() {
  const data = registry.load();
  const used = new Set();
  for (const sb of Object.values(data.sandboxes)) {
    if (!sb.mcp) continue;
    for (const entry of Object.values(sb.mcp)) {
      if (entry.port) used.add(entry.port);
    }
  }
  return used;
}

function nextAvailablePort() {
  const used = getAllUsedPorts();
  for (let p = MCP_PORT_START; p <= MCP_PORT_END; p++) {
    if (!used.has(p)) return p;
  }
  return null;
}

function validatePort(port) {
  if (port < MCP_PORT_START || port > MCP_PORT_END) {
    console.error(
      `  Port ${port} is outside the MCP range ${MCP_PORT_START}-${MCP_PORT_END}.`,
    );
    process.exit(1);
  }
  const used = getAllUsedPorts();
  if (used.has(port)) {
    console.error(`  Port ${port} is already in use by another MCP bridge.`);
    process.exit(1);
  }
}

// ── SSH into sandbox ────────────────────────────────────────────

function sshExec(sandboxName, command) {
  const openshell = resolveOpenshell();
  if (!openshell) {
    console.error("  openshell not found.");
    process.exit(1);
  }
  const sshConfig = runCapture(
    `"${openshell}" sandbox ssh-config "${sandboxName}"`,
  );
  const os = require("os");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-ssh-"));
  const confPath = path.join(tmpDir, "config");
  fs.writeFileSync(confPath, sshConfig, { mode: 0o600 });
  try {
    return runCapture(
      `ssh -T -F "${confPath}" -o ConnectTimeout=10 "openshell-${sandboxName}" '${command.replace(/'/g, "'\\''")}'`,
      { ignoreError: true },
    );
  } finally {
    try {
      fs.unlinkSync(confPath);
      fs.rmdirSync(tmpDir);
    } catch {}
  }
}

// ── Egress rule approval ────────────────────────────────────────

function approveEgressRule(sandboxName, port) {
  const openshell = resolveOpenshell();
  if (!openshell) return;

  // Trigger a connection attempt so the egress proxy generates a pending rule
  sshExec(
    sandboxName,
    `curl -s --max-time 3 http://${MCP_HOST}:${port} 2>/dev/null || true`,
  );

  // Poll for the pending rule and approve it (try both node and curl binaries)
  for (let attempt = 0; attempt < 3; attempt++) {
    const rulesOutput = runCapture(
      `"${openshell}" rule get "${sandboxName}" 2>/dev/null`,
      { ignoreError: true },
    );
    if (!rulesOutput) continue;

    // Parse chunk IDs for rules matching our exact host:port that are pending.
    // Use Endpoints field for precise matching to avoid approving unrelated rules.
    const exactEndpoint = `${MCP_HOST}:${port}`;
    const chunks = rulesOutput.split(/\n\s*Chunk:\s*/);
    for (const chunk of chunks) {
      const isPending = /Status:.*pending/i.test(chunk);
      const endpointsMatch = chunk.match(/Endpoints:\s*(.+)/);
      const matchesHost =
        endpointsMatch && endpointsMatch[1].trim() === exactEndpoint;
      if (!isPending || !matchesHost) continue;

      const idMatch = chunk.match(
        /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/,
      );
      if (idMatch) {
        const result = runCapture(
          `"${openshell}" rule approve --chunk-id "${idMatch[1]}" "${sandboxName}" 2>&1`,
          { ignoreError: true },
        );
        if (result && /approved/i.test(result)) {
          console.log(`  Egress rule approved for ${MCP_HOST}:${port}.`);
        }
      }
    }

    // Check if any rules for our exact endpoint were approved
    const updatedRules = runCapture(
      `"${openshell}" rule get "${sandboxName}" 2>/dev/null`,
      { ignoreError: true },
    );
    if (updatedRules) {
      const updatedChunks = updatedRules.split(/\n\s*Chunk:\s*/);
      const approved = updatedChunks.some((c) => {
        const ep = c.match(/Endpoints:\s*(.+)/);
        return (
          ep && ep[1].trim() === exactEndpoint && /Status:.*approved/i.test(c)
        );
      });
      if (approved) return;
    }

    // Brief pause before retry
    try {
      require("child_process").spawnSync("sleep", ["1"]);
    } catch {}
  }

  console.log(
    `  Note: egress rule for ${MCP_HOST}:${port} may need manual approval.`,
  );
  console.log(`  Run: openshell rule get "${sandboxName}"`);
  console.log(
    `  Then: openshell rule approve --chunk-id <id> "${sandboxName}"`,
  );
}

// ── mcporter bootstrap ──────────────────────────────────────────

function ensureMcporter(sandboxName) {
  const check = sshExec(sandboxName, "command -v mcporter");
  if (check && check.trim()) return true;

  console.log("  Installing mcporter in sandbox...");
  sshExec(sandboxName, "npm install --prefix /sandbox/.local mcporter 2>&1");

  // Ensure PATH includes mcporter
  const profileLine = 'export PATH="/sandbox/.local/node_modules/.bin:$PATH"';
  sshExec(
    sandboxName,
    `grep -qF '${profileLine}' /sandbox/.bash_profile 2>/dev/null || echo '${profileLine}' >> /sandbox/.bash_profile`,
  );

  const verify = sshExec(sandboxName, "mcporter --version");
  if (verify && verify.trim()) {
    console.log(`  mcporter ${verify.trim()} installed.`);
    return true;
  }

  console.error("  Failed to install mcporter in sandbox.");
  return false;
}

// ── Add ─────────────────────────────────────────────────────────

function add(sandboxName, opts) {
  validateName(sandboxName);
  const {
    name,
    command,
    args: cmdArgs = [],
    env = {},
    port: requestedPort,
  } = opts;

  if (!name) {
    console.error("  Name is required: nemoclaw <sb> mcp add <name> ...");
    process.exit(1);
  }
  validateName(name);

  if (!command) {
    console.error(
      "  Command is required after '--': nemoclaw <sb> mcp add <name> -- <command> [args...]",
    );
    process.exit(1);
  }

  // Validate sandbox exists
  const sandbox = registry.getSandbox(sandboxName);
  if (!sandbox) {
    console.error(`  Sandbox '${sandboxName}' not found.`);
    process.exit(1);
  }

  // Check for duplicate
  if (sandbox.mcp && sandbox.mcp[name]) {
    console.error(
      `  MCP server '${name}' already exists on sandbox '${sandboxName}'.`,
    );
    console.error(`  Use 'nemoclaw ${sandboxName} mcp remove ${name}' first.`);
    process.exit(1);
  }

  // Validate env var names
  const envNames = Object.keys(env);
  for (const v of envNames) {
    validateEnvName(v);
  }

  // Assign port
  if (requestedPort) validatePort(requestedPort);
  const port = requestedPort || nextAvailablePort();
  if (!port) {
    console.error(
      `  No available ports in range ${MCP_PORT_START}-${MCP_PORT_END}.`,
    );
    process.exit(1);
  }

  // Start the proxy on 127.0.0.1 (not exposed to network)
  console.log(`  Starting MCP proxy for '${name}' on port ${port}...`);
  const dir = pidDir(sandboxName);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  const proxyArgs = ["--exe", command, "--port", String(port)];
  for (const arg of cmdArgs) {
    proxyArgs.push("--arg", arg);
  }
  for (const v of envNames) {
    proxyArgs.push("--env", v);
  }

  // Build minimal env for the proxy — only PATH, HOME, and named vars
  // Values come from the -e KEY=VALUE pairs, not from the host environment
  const proxyEnv = { PATH: process.env.PATH, HOME: process.env.HOME };
  for (const [k, v] of Object.entries(env)) proxyEnv[k] = v;

  const logPath = path.join(dir, `mcp-${name}.log`);
  const logFd = fs.openSync(logPath, "a");
  const proc = spawn("node", [PROXY_SCRIPT, ...proxyArgs], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: proxyEnv,
  });
  proc.unref();
  fs.closeSync(logFd);
  writePidFile(pidFile(sandboxName, name), proc.pid);
  console.log(`  Proxy started (PID ${proc.pid}).`);

  // Approve egress rule so sandbox can reach host.docker.internal:<port>
  console.log(`  Approving egress rule for ${MCP_HOST}:${port}...`);
  approveEgressRule(sandboxName, port);

  // Bootstrap mcporter and register server
  console.log("  Registering server in sandbox...");
  if (!ensureMcporter(sandboxName)) {
    console.error("  Could not bootstrap mcporter. Rolling back...");
    try {
      process.kill(proc.pid, "SIGTERM");
    } catch {}
    try {
      fs.unlinkSync(pidFile(sandboxName, name));
    } catch {}
    return;
  }

  // name is validated by validateName (alphanumeric + hyphens/underscores only)
  // port is a validated integer — both are safe to interpolate
  const configOut = sshExec(
    sandboxName,
    `mcporter config add '${name}' --url 'http://${MCP_HOST}:${port}' --scope home 2>&1`,
  );
  if (!configOut || /error/i.test(configOut)) {
    console.error("  mcporter config add failed. Rolling back...");
    console.error(`  ${(configOut || "no output").trim()}`);
    try {
      process.kill(proc.pid, "SIGTERM");
    } catch {}
    try {
      fs.unlinkSync(pidFile(sandboxName, name));
    } catch {}
    return;
  }

  // Save to registry — env values stored inline (mode 600 file)
  const mcp = sandbox.mcp || {};
  mcp[name] = {
    command,
    args: cmdArgs,
    env,
    port,
    addedAt: new Date().toISOString(),
  };
  registry.updateSandbox(sandboxName, { mcp });

  console.log(`  MCP server '${name}' added to sandbox '${sandboxName}'.`);
}

// ── Remove ──────────────────────────────────────────────────────

function remove(sandboxName, serverName) {
  validateName(sandboxName);
  if (!serverName) {
    console.error("  Server name is required.");
    process.exit(1);
  }
  validateName(serverName);

  const sandbox = registry.getSandbox(sandboxName);
  if (!sandbox || !sandbox.mcp || !sandbox.mcp[serverName]) {
    console.error(
      `  MCP server '${serverName}' not found on sandbox '${sandboxName}'.`,
    );
    process.exit(1);
  }

  const entry = sandbox.mcp[serverName];

  // Stop proxy
  const pid = pidFile(sandboxName, serverName);
  const runningPid = isRunning(pid);
  if (runningPid) {
    try {
      process.kill(runningPid, "SIGTERM");
      console.log(`  Proxy stopped (PID ${runningPid}).`);
    } catch {}
  }
  try {
    fs.unlinkSync(pid);
  } catch {}

  // Remove from sandbox mcporter config
  sshExec(sandboxName, `mcporter config remove '${serverName}' 2>&1 || true`);

  // Remove from registry
  delete sandbox.mcp[serverName];
  registry.updateSandbox(sandboxName, { mcp: sandbox.mcp });

  console.log(
    `  MCP server '${serverName}' removed from sandbox '${sandboxName}'.`,
  );
}

// ── List ────────────────────────────────────────────────────────

function list(sandboxName) {
  validateName(sandboxName);
  const sandbox = registry.getSandbox(sandboxName);
  if (!sandbox || !sandbox.mcp || Object.keys(sandbox.mcp).length === 0) {
    console.log("");
    console.log(`  No MCP bridges for sandbox '${sandboxName}'.`);
    console.log("");
    return;
  }

  console.log("");
  console.log(`  MCP Bridges for sandbox "${sandboxName}":`);
  console.log("");

  for (const [name, entry] of Object.entries(sandbox.mcp)) {
    const pid = pidFile(sandboxName, name);
    const running = isRunning(pid);
    const marker = running ? "\x1b[32m●\x1b[0m" : "\x1b[31m○\x1b[0m";
    const status = running ? "" : "  (stopped)";
    const envKeys = Array.isArray(entry.env)
      ? entry.env
      : Object.keys(entry.env || {});
    const envStr =
      envKeys.length > 0 ? `env: ${envKeys.join(", ")}` : "env: (none)";
    const cmdDisplay = [entry.command, ...(entry.args || [])].join(" ");
    const source = cmdDisplay;
    console.log(
      `    ${marker} ${name.padEnd(14)} :${entry.port}  ${source.slice(0, 45).padEnd(45)}  ${envStr}${status}`,
    );
  }
  console.log("");
}

// ── Restart ─────────────────────────────────────────────────────

function restart(sandboxName, serverName) {
  validateName(sandboxName);
  if (serverName) validateName(serverName);
  const sandbox = registry.getSandbox(sandboxName);
  if (!sandbox || !sandbox.mcp) {
    console.log("  No MCP bridges to restart.");
    return;
  }

  const servers = serverName
    ? { [serverName]: sandbox.mcp[serverName] }
    : sandbox.mcp;

  for (const [name, entry] of Object.entries(servers)) {
    if (!entry) {
      console.error(`  MCP server '${name}' not found.`);
      continue;
    }

    console.log(`  Restarting '${name}'...`);

    // Stop existing proxy if running
    const pid = pidFile(sandboxName, name);
    const runningPid = isRunning(pid);
    if (runningPid) {
      try {
        process.kill(runningPid, "SIGTERM");
      } catch {}
      try {
        fs.unlinkSync(pid);
      } catch {}
    }

    // Env values are stored inline in the registry — no host env vars needed
    const entryEnv = entry.env || {};
    const envNames = Array.isArray(entryEnv) ? entryEnv : Object.keys(entryEnv);

    // Start proxy
    const dir = pidDir(sandboxName);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

    const exe = entry.command;
    const entryArgs = entry.args || [];
    const proxyArgs = ["--exe", exe, "--port", String(entry.port)];
    for (const arg of entryArgs) {
      proxyArgs.push("--arg", arg);
    }
    for (const v of envNames) {
      proxyArgs.push("--env", v);
    }

    // Build minimal env for the proxy — values from stored config
    const proxyEnv = { PATH: process.env.PATH, HOME: process.env.HOME };
    if (Array.isArray(entryEnv)) {
      // Legacy format: env is ["VAR"] — read from host environment
      for (const v of entryEnv) proxyEnv[v] = process.env[v] || "";
    } else {
      // New format: env is { "VAR": "value" } — read from stored config
      for (const [k, v] of Object.entries(entryEnv)) proxyEnv[k] = v;
    }

    const logPath = path.join(dir, `mcp-${name}.log`);
    const logFd = fs.openSync(logPath, "a");
    const proc = spawn("node", [PROXY_SCRIPT, ...proxyArgs], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: proxyEnv,
    });
    proc.unref();
    fs.closeSync(logFd);
    writePidFile(pidFile(sandboxName, name), proc.pid);

    // Approve egress rule (may already be approved from initial add)
    approveEgressRule(sandboxName, entry.port);

    console.log(`    Started (PID ${proc.pid}, port ${entry.port}).`);
  }
}

module.exports = { add, remove, list, restart, ensureMcporter };
