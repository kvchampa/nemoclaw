// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Self-update functionality for NemoClaw CLI

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const https = require("https");
const http = require("http");

const INSTALL_SCRIPT_URL = "https://raw.githubusercontent.com/NVIDIA/NemoClaw/main/install.sh";

/**
 * Compare two semver strings. Returns true if a >= b.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function versionGte(a, b) {
  const normalize = (v) => v.replace(/^v/, "").split(/[-+]/)[0].split(".").map(n => parseInt(n, 10) || 0);
  const aParts = normalize(a);
  const bParts = normalize(b);
  for (let i = 0; i < 3; i++) {
    const ai = aParts[i] || 0;
    const bi = bParts[i] || 0;
    if (ai > bi) return true;
    if (ai < bi) return false;
  }
  return true;
}

/**
 * Fetch content from a URL using Node.js built-in http/https.
 * @param {string} url
 * @returns {Promise<string>}
 */
function fetchUrl(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, { 
      timeout: 10000,
      headers: { "User-Agent": "NemoClaw" }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (redirectCount >= 5) {
          reject(new Error("Too many redirects"));
          return;
        }
        fetchUrl(res.headers.location, redirectCount + 1).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
  });
}

/**
 * Get the current installed version of NemoClaw.
 * @param {boolean} clearCache - Clear Node's require cache before reading
 * @returns {string}
 */
function getCurrentVersion(clearCache = false) {
  try {
    if (clearCache) {
      delete require.cache[require.resolve("../../package.json")];
    }
    const pkg = require("../../package.json");
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Get the current CLI path to determine if running from source.
 * @returns {string|null}
 */
function getCurrentCliPath() {
  try {
    return execSync("which nemoclaw 2>/dev/null", { encoding: "utf-8" }).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Get the latest version from GitHub releases.
 * @returns {Promise<string>}
 */
async function getLatestVersion() {
  try {
    const data = await fetchUrl("https://api.github.com/repos/NVIDIA/NemoClaw/releases/latest");
    const release = JSON.parse(data);
    return release.tag_name || release.name || "0.0.0";
  } catch {
    return getCurrentVersion();
  }
}

/**
 * Get the latest version from npm.
 * @returns {Promise<string>}
 */
async function getLatestNpmVersion() {
  try {
    const data = await fetchUrl("https://registry.npmjs.org/nemoclaw/latest");
    const pkg = JSON.parse(data);
    return pkg.version || "0.0.0";
  } catch {
    return getCurrentVersion();
  }
}

/**
 * Check if an update is available.
 * @returns {Promise<{current: string, latest: string, updateAvailable: boolean, runningFromSource: boolean}>}
 */
async function checkForUpdate() {
  const cliPath = getCurrentCliPath();
  const runningFromSource = !cliPath;

  let current = getCurrentVersion();
  if (runningFromSource && cliPath) {
    try {
      const output = execSync(`"${cliPath}" --version 2>/dev/null`, { encoding: "utf-8" });
      const match = output.match(/(\d+\.\d+\.\d+)/);
      if (match) current = match[1];
    } catch {}
  }

  const latestNpm = await getLatestNpmVersion();
  const latestGithub = await getLatestVersion();

  const latest = versionGte(latestNpm, latestGithub) ? latestNpm : latestGithub;
  const updateAvailable = !versionGte(current, latest);

  return { current, latest, updateAvailable, runningFromSource };
}

/**
 * Run the update. Downloads and executes the install script.
 * @param {object} opts
 * @param {boolean} opts.force - Force update even if already up to date
 * @param {boolean} opts.yes - Skip confirmation prompt
 * @returns {Promise<boolean>}
 */
async function runUpdate(opts = {}) {
  const { force = false, yes = false } = opts;

  console.log("");
  console.log("  Checking for updates...");
  console.log("");

  const { current, latest, updateAvailable, runningFromSource } = await checkForUpdate();

  console.log(`  Current version: ${current}`);
  console.log(`  Latest version:  ${latest}`);

  if (!force && !updateAvailable) {
    console.log("");
    console.log("  You are running the latest version.");
    return true;
  }

  if (!yes) {
    console.log("");
    if (updateAvailable) {
      console.log("  A new version is available!");
    } else if (force) {
      console.log("  Reinstalling current version (--force was provided).");
    } else {
      console.log("  You are running the latest version.");
    }
    console.log("");
    if (runningFromSource) {
      console.log("  Since you're running from source, use 'git pull' to update:");
      console.log("    cd /path/to/NemoClaw && git pull");
    } else {
      const cmd = `nemoclaw update --yes${force ? " --force" : ""}`;
      console.log(`  Run '${cmd}' to update without prompting.`);
    }
    return false;
  }

  if (runningFromSource) {
    console.log("");
    console.log("  Since you're running from source, use 'git pull' to update:");
    console.log("    cd /path/to/NemoClaw && git pull");
    return false;
  }

  console.log("");
  console.log("  Updating NemoClaw...");
  console.log("");

  let tmpDir;
  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-update-"));

    console.log("  Downloading installer...");
    const scriptContent = await fetchUrl(INSTALL_SCRIPT_URL);

    const crypto = require("crypto");
    const hash = crypto.createHash("sha256").update(scriptContent).digest("hex");
    console.log(`  Script SHA256: ${hash.substring(0, 16)}...`);

    const scriptPath = path.join(tmpDir, "install.sh");
    fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 });

    console.log("  Running installer...");
    execSync(`bash "${scriptPath}"`, {
      stdio: "inherit",
      cwd: tmpDir
    });

    const newVersion = getCurrentVersion(true);
    console.log("");
    console.log(`  Successfully updated to v${newVersion}`);
    return true;
  } catch (err) {
    console.error("");
    console.error(`  Update failed: ${err.message}`);
    console.error("");
    console.error("  You can also update manually with:");
    console.error("    npm install -g nemoclaw");
    return false;
  } finally {
    try {
      if (tmpDir && fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch {}
  }
}

module.exports = {
  getCurrentVersion,
  getCurrentCliPath,
  getLatestVersion,
  getLatestNpmVersion,
  checkForUpdate,
  runUpdate,
};
