#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
#
# Safe upgrade helper: back up workspace (and optionally all OpenClaw state), then
# optionally run `nemoclaw onboard` to rebuild the sandbox image from the repo.
#
# Does not destroy the sandbox by itself — `nemoclaw onboard` behavior depends on
# your OpenShell/NemoClaw version (may recreate the sandbox). Always have backups.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKUP_BASE="${HOME}/.nemoclaw/backups"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info() { echo -e "${GREEN}[upgrade]${NC} $1"; }
warn() { echo -e "${YELLOW}[upgrade]${NC} $1"; }
fail() {
  echo -e "${RED}[upgrade]${NC} $1" >&2
  exit 1
}

usage() {
  cat <<EOF
Usage:
  $(basename "$0") [options] <sandbox-name>

Backs up workspace files via scripts/backup-workspace.sh, then optionally snapshots
/sandbox/.openclaw-data/ and/or runs nemoclaw onboard from the NemoClaw repo.

Options:
  --full-data     Also download /sandbox/.openclaw-data/ (agents, sessions, plugins;
                  can be large). Stored under the same timestamp as workspace backup.
  --run-onboard   After backups, run: nemoclaw onboard (from NEMOCLAW_REPO_ROOT or ${REPO_ROOT})
  --yes           With --run-onboard, skip the confirmation prompt
  --no-restore    With --run-onboard, do not run backup-workspace.sh restore after onboard
  -h, --help      Show this help

Environment:
  NEMOCLAW_REPO_ROOT   Directory containing install.sh and Dockerfile (default: parent of scripts/)
  NEMOCLAW_NON_INTERACTIVE  Defaults to 1 for --run-onboard (no prompts). Set to 0 for interactive onboard.
  NEMOCLAW_RECREATE_SANDBOX  Defaults to 1 with --run-onboard so the named sandbox is rebuilt. Set to 0 to fail if it already exists.

Example:
  $(basename "$0") --full-data my-assistant
  $(basename "$0") --run-onboard --yes my-assistant
  $(basename "$0") --run-onboard --yes --no-restore my-assistant   # keep fresh workspace after rebuild
EOF
  exit "${1:-0}"
}

command -v openshell >/dev/null 2>&1 || fail "'openshell' is required but not found in PATH."

FULL_DATA=0
RUN_ONBOARD=0
YES=0
NO_RESTORE=0
SANDBOX=""

while [ $# -gt 0 ]; do
  case "$1" in
    --full-data) FULL_DATA=1 ;;
    --run-onboard) RUN_ONBOARD=1 ;;
    --yes) YES=1 ;;
    --no-restore) NO_RESTORE=1 ;;
    -h | --help) usage 0 ;;
    -*)
      fail "Unknown option: $1 (try --help)"
      ;;
    *)
      [ -z "$SANDBOX" ] || fail "Unexpected extra argument: $1"
      SANDBOX="$1"
      ;;
  esac
  shift
done

[ -n "$SANDBOX" ] || usage 1

BACKUP_WORKSPACE="${REPO_ROOT}/scripts/backup-workspace.sh"
[ -x "$BACKUP_WORKSPACE" ] || [ -f "$BACKUP_WORKSPACE" ] || fail "Missing ${BACKUP_WORKSPACE}"

info "Sandbox: ${SANDBOX}"
info "Step 1/3: Workspace backup (SOUL, USER, identity, etc.)..."
bash "$BACKUP_WORKSPACE" backup "$SANDBOX"

TS=""
if [ -d "$BACKUP_BASE" ]; then
  # shellcheck disable=SC2012  # backup dirs are YYYYMMDD-HHMMSS — no special chars
  TS="$(ls -1t "$BACKUP_BASE" 2>/dev/null | head -n1 || true)"
fi
[ -n "$TS" ] || fail "No backup directory found under ${BACKUP_BASE}/"
DEST="${BACKUP_BASE}/${TS}"
info "Latest backup directory: ${DEST}/"

if [ "$FULL_DATA" -eq 1 ]; then
  info "Step 2/3: Full OpenClaw snapshot (/sandbox/.openclaw-data/)..."
  mkdir -p "${DEST}/openclaw-data"
  if openshell sandbox download "$SANDBOX" /sandbox/.openclaw-data/ "${DEST}/openclaw-data/"; then
    info "Saved openclaw-data under ${DEST}/openclaw-data/"
  else
    warn "openclaw-data download failed or was empty; workspace files in ${DEST}/ are still valid."
  fi
else
  info "Step 2/3: Skipped full openclaw-data (--full-data not set)."
fi

info "Step 3/3: Onboard / image rebuild"
if [ "$RUN_ONBOARD" -eq 1 ]; then
  ROOT="${NEMOCLAW_REPO_ROOT:-$REPO_ROOT}"
  [ -f "${ROOT}/install.sh" ] || fail "NEMOCLAW_REPO_ROOT must contain install.sh (got ${ROOT})"
  command -v nemoclaw >/dev/null 2>&1 || fail "'nemoclaw' not found in PATH; install the CLI or omit --run-onboard"
  if [ "$YES" -ne 1 ]; then
    echo -e "${CYAN}This will run ${ROOT}/install.sh flow via \`nemoclaw onboard\`, which may recreate the sandbox.${NC}"
    read -r -p "Continue? [y/N] " reply
    case "$reply" in
      y | Y | yes | YES) ;;
      *)
        info "Aborted. Restore later with: ./scripts/backup-workspace.sh restore ${SANDBOX} ${TS}"
        exit 0
        ;;
    esac
  fi
  # Non-interactive onboard: same sandbox name as CLI, no inference prompts (uses registry / env / defaults).
  export NEMOCLAW_NON_INTERACTIVE="${NEMOCLAW_NON_INTERACTIVE:-1}"
  export NEMOCLAW_SANDBOX_NAME="$SANDBOX"
  export NEMOCLAW_RECREATE_SANDBOX="${NEMOCLAW_RECREATE_SANDBOX:-1}"
  (cd "$ROOT" && exec nemoclaw onboard)
  if [ "$NO_RESTORE" -eq 1 ]; then
    info "Skipping automatic workspace restore (--no-restore)."
    info "To restore manually: ./scripts/backup-workspace.sh restore ${SANDBOX} ${TS}"
  else
    info "Restoring workspace from backup ${TS}..."
    bash "$BACKUP_WORKSPACE" restore "$SANDBOX" "$TS"
  fi
else
  echo ""
  info "Backups complete. To rebuild the image and re-run setup (pick up Dockerfile changes):"
  echo -e "  ${CYAN}cd ${REPO_ROOT}${NC}"
  echo -e "  ${CYAN}nemoclaw onboard${NC}"
  echo ""
  warn "If onboard recreates the sandbox, restore workspace with:"
  echo -e "  ${CYAN}./scripts/backup-workspace.sh restore ${SANDBOX} ${TS}${NC}"
  if [ "$FULL_DATA" -eq 1 ] && [ -d "${DEST}/openclaw-data" ]; then
    warn "For a full state restore, re-upload ${DEST}/openclaw-data/ with openshell sandbox upload (see docs)."
  fi
fi

info "Done."
