#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

WORKSPACE_PATH="/sandbox/.openclaw/workspace"
BACKUP_BASE="${HOME}/.nemoclaw/backups"

# Core persona files — expected once the agent has initialized workspace.
FILES_CORE=(SOUL.md USER.md IDENTITY.md AGENTS.md)
# Long-term memory — created later; missing paths are normal (no noisy tar errors).
FILES_OPTIONAL=(MEMORY.md)
DIRS_OPTIONAL=(memory)

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
DIM='\033[0;90m'
NC='\033[0m'

info() { echo -e "${GREEN}[backup]${NC} $1"; }
warn() { echo -e "${YELLOW}[backup]${NC} $1"; }
fail() {
  echo -e "${RED}[backup]${NC} $1" >&2
  exit 1
}

usage() {
  cat <<EOF
Usage:
  $(basename "$0") backup  <sandbox-name>
  $(basename "$0") restore <sandbox-name> [timestamp]

Commands:
  backup   Download workspace files from a sandbox to a timestamped local backup.
  restore  Upload workspace files from a local backup into a sandbox.
           If no timestamp is given, the most recent backup is used.

Backup location: ${BACKUP_BASE}/<timestamp>/
EOF
  exit 1
}

# Download from sandbox. Optional paths suppress stderr because openshell/tar
# emit multi-line errors when a file or directory does not exist yet.
sandbox_download() {
  local sandbox="$1" remote="$2" dest="$3"
  local quiet="${4:-0}"
  if [[ "$quiet" == "1" ]]; then
    openshell sandbox download "$sandbox" "$remote" "$dest" 2>/dev/null
  else
    openshell sandbox download "$sandbox" "$remote" "$dest"
  fi
}

do_backup() {
  local sandbox="$1"
  local ts
  ts="$(date +%Y%m%d-%H%M%S)"
  local dest="${BACKUP_BASE}/${ts}"

  mkdir -p "$BACKUP_BASE"
  chmod 0700 "${HOME}/.nemoclaw" "$BACKUP_BASE" \
    || fail "Failed to set secure permissions on ${HOME}/.nemoclaw — check directory ownership."
  mkdir -p "$dest"
  chmod 0700 "$dest"

  info "Backing up workspace from sandbox '${sandbox}'..."

  local count=0
  local f d

  for f in "${FILES_CORE[@]}"; do
    if sandbox_download "$sandbox" "${WORKSPACE_PATH}/${f}" "${dest}/" 0; then
      count=$((count + 1))
    else
      warn "Skipped ${f} (not found or download failed)"
    fi
  done

  for f in "${FILES_OPTIONAL[@]}"; do
    if sandbox_download "$sandbox" "${WORKSPACE_PATH}/${f}" "${dest}/" 1; then
      count=$((count + 1))
    else
      echo -e "${DIM}[backup]${NC} Optional ${f} not in sandbox — skipped (normal until created)."
    fi
  done

  for d in "${DIRS_OPTIONAL[@]}"; do
    if sandbox_download "$sandbox" "${WORKSPACE_PATH}/${d}/" "${dest}/${d}/" 1; then
      count=$((count + 1))
    else
      echo -e "${DIM}[backup]${NC} Optional ${d}/ not in sandbox — skipped (normal until created)."
    fi
  done

  if [ "$count" -eq 0 ]; then
    fail "No files were backed up. Check that the sandbox '${sandbox}' exists and has workspace files."
  fi

  info "Backup saved to ${dest}/ (${count} items)"
}

# Latest backup directory name (mtime); portable (no find -printf).
latest_backup_timestamp() {
  if [ ! -d "$BACKUP_BASE" ]; then
    return 1
  fi
  # shellcheck disable=SC2012  # backup dirs are YYYYMMDD-HHMMSS — no special chars
  ls -1t "$BACKUP_BASE" 2>/dev/null | head -n1
}

do_restore() {
  local sandbox="$1"
  local ts="${2:-}"

  if [ -z "$ts" ]; then
    ts="$(latest_backup_timestamp || true)"
    [ -n "$ts" ] || fail "No backups found in ${BACKUP_BASE}/"
    info "Using most recent backup: ${ts}"
  fi

  local src="${BACKUP_BASE}/${ts}"
  [ -d "$src" ] || fail "Backup directory not found: ${src}"

  info "Restoring workspace to sandbox '${sandbox}' from ${src}..."

  local count=0
  local f d

  for f in "${FILES_CORE[@]}"; do
    if [ -f "${src}/${f}" ]; then
      if openshell sandbox upload "$sandbox" "${src}/${f}" "${WORKSPACE_PATH}/"; then
        count=$((count + 1))
      else
        warn "Failed to restore ${f}"
      fi
    fi
  done

  for f in "${FILES_OPTIONAL[@]}"; do
    if [ -f "${src}/${f}" ]; then
      if openshell sandbox upload "$sandbox" "${src}/${f}" "${WORKSPACE_PATH}/"; then
        count=$((count + 1))
      else
        warn "Failed to restore ${f}"
      fi
    fi
  done

  for d in "${DIRS_OPTIONAL[@]}"; do
    if [ -d "${src}/${d}" ]; then
      if openshell sandbox upload "$sandbox" "${src}/${d}/" "${WORKSPACE_PATH}/${d}/"; then
        count=$((count + 1))
      else
        warn "Failed to restore ${d}/"
      fi
    fi
  done

  if [ "$count" -eq 0 ]; then
    fail "No files were restored. Check that the sandbox '${sandbox}' is running."
  fi

  info "Restored ${count} items to sandbox '${sandbox}'."
}

# --- Main ---

[ $# -ge 2 ] || usage
command -v openshell >/dev/null 2>&1 || fail "'openshell' is required but not found in PATH."

action="$1"
sandbox="$2"
shift 2

case "$action" in
  backup) do_backup "$sandbox" ;;
  restore) do_restore "$sandbox" "$@" ;;
  *) usage ;;
esac
