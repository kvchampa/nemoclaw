# Smoke-test script for the NemoClaw OCI container.
# Loads the image into Docker, runs structural checks, and reports image size.
#
# Usage: nix run .#container-test
{
  writeShellApplication,
  docker,
  coreutils,
  gawk,
  constants,
  container,
}:

writeShellApplication {
  name = "nemoclaw-container-test";

  runtimeInputs = [
    docker
    coreutils
    gawk
  ];

  text = ''
    set -euo pipefail

    IMAGE="nemoclaw:${constants.nemoclawVersion}"
    CONTAINER=""
    PASS=0
    FAIL=0

    cleanup() {
      if [ -n "$CONTAINER" ]; then
        docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
      fi
    }
    trap cleanup EXIT

    check() {
      local desc="$1"; shift
      if "$@" >/dev/null 2>&1; then
        echo "  PASS  $desc"
        PASS=$((PASS + 1))
      else
        echo "  FAIL  $desc"
        FAIL=$((FAIL + 1))
      fi
    }

    check_output() {
      local desc="$1" expected="$2"; shift 2
      local output
      output=$("$@" 2>&1) || true
      if echo "$output" | grep -qF "$expected"; then
        echo "  PASS  $desc"
        PASS=$((PASS + 1))
      else
        echo "  FAIL  $desc (expected '$expected', got '$output')"
        FAIL=$((FAIL + 1))
      fi
    }

    run_in() {
      docker exec "$CONTAINER" bash -c "$1"
    }

    # ── Load image ──────────────────────────────────────────────
    echo "Loading container image..."
    docker load < ${container}

    # ── Report image size ───────────────────────────────────────
    echo ""
    echo "=== Image Size ==="
    docker image inspect "$IMAGE" --format='{{.Size}}' \
      | awk '{ printf "  Uncompressed: %.0f MiB\n", $1/1024/1024 }'
    TARBALL_SIZE=$(stat -c%s ${container})
    echo "  Compressed tarball: $((TARBALL_SIZE / 1024 / 1024)) MiB"
    echo ""

    # ── Start container ─────────────────────────────────────────
    echo "Starting container..."
    CONTAINER=$(docker create --name nemoclaw-nix-test --entrypoint /bin/bash "$IMAGE" -c "sleep 300")
    docker start "$CONTAINER"

    echo ""
    echo "=== Structural Checks ==="

    # Binaries present
    check "node is on PATH"        run_in "command -v node"
    check "python3 is on PATH"     run_in "command -v python3"
    check "openclaw is on PATH"    run_in "command -v openclaw"
    check "nemoclaw is on PATH"    run_in "command -v nemoclaw"
    check "git is on PATH"         run_in "command -v git"
    check "curl is on PATH"        run_in "command -v curl"
    check "bash is on PATH"        run_in "command -v bash"

    # Runtime versions
    check "node is v${constants.nodeVersion}.x"  run_in "node -e \"assert(process.version.startsWith('v${constants.nodeVersion}.'))\""

    # Filesystem layout
    check "/sandbox exists"                       run_in "test -d /sandbox"
    check ".openclaw dir exists"                  run_in "test -d ${constants.paths.openclawConfig}"
    check ".openclaw-data dir exists"             run_in "test -d ${constants.paths.openclawData}"
    check "plugin dir exists"                     run_in "test -d ${constants.paths.pluginDir}"
    check "plugin dist/ exists"                   run_in "test -d ${constants.paths.pluginDir}/dist"
    check "plugin package.json exists"            run_in "test -f ${constants.paths.pluginDir}/package.json"
    check "plugin openclaw.plugin.json exists"    run_in "test -f ${constants.paths.pluginDir}/openclaw.plugin.json"
    check "plugin registry exists"                run_in "test -f ${constants.paths.openclawData}/extensions/plugins.json"
    check "nemoclaw-start script exists"          run_in "test -x /usr/local/bin/nemoclaw-start"
    check "blueprints dir exists"                 run_in "test -d ${constants.paths.nemoclawState}/blueprints/${constants.nemoclawVersion}"

    # Symlinks from .openclaw -> .openclaw-data
    check "agents symlink"     run_in "test -L ${constants.paths.openclawConfig}/agents"
    check "extensions symlink" run_in "test -L ${constants.paths.openclawConfig}/extensions"
    check "workspace symlink"  run_in "test -L ${constants.paths.openclawConfig}/workspace"

    # User/permissions
    check_output "runs as uid ${toString constants.user.uid}" "${toString constants.user.uid}" run_in "id -u"
    check_output "runs as gid ${toString constants.user.gid}" "${toString constants.user.gid}" run_in "id -g"

    # passwd/group
    check "/etc/passwd exists" run_in "test -f /etc/passwd"
    check "/etc/group exists"  run_in "test -f /etc/group"

    # Entrypoint
    check_output "entrypoint is nemoclaw-start" "/usr/local/bin/nemoclaw-start" \
      docker inspect "$IMAGE" --format '{{join .Config.Entrypoint " "}}'

    # SSL certs (needed for API calls)
    check "CA certs available" run_in "test -f /etc/ssl/certs/ca-bundle.crt"

    # pyyaml importable
    check "pyyaml importable" run_in "python3 -c 'import yaml'"

    # ── Summary ─────────────────────────────────────────────────
    echo ""
    TOTAL=$((PASS + FAIL))
    echo "=== Results: $PASS/$TOTAL passed ==="
    if [ "$FAIL" -gt 0 ]; then
      echo "FAILED: $FAIL check(s) did not pass."
      exit 1
    else
      echo "All checks passed."
    fi
  '';
}
