#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
#
# Install the openshell CLI binary. Supports Linux and macOS (x86_64 and aarch64).

set -euo pipefail

fail() { printf "Error: %s\n" "$1" >&2; exit 1; }

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS/$ARCH" in
  Darwin/x86_64|Darwin/amd64)   ASSET="openshell-x86_64-apple-darwin.tar.gz" ;;
  Darwin/aarch64|Darwin/arm64)  ASSET="openshell-aarch64-apple-darwin.tar.gz" ;;
  Linux/x86_64|Linux/amd64)     ASSET="openshell-x86_64-unknown-linux-musl.tar.gz" ;;
  Linux/aarch64|Linux/arm64)    ASSET="openshell-aarch64-unknown-linux-musl.tar.gz" ;;
  *) fail "Unsupported platform: $OS/$ARCH" ;;
esac

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

DOWNLOAD_URL="https://github.com/NVIDIA/OpenShell/releases/latest/download/$ASSET"

# Download with better error handling
if ! curl -fsSL "$DOWNLOAD_URL" -o "$tmpdir/$ASSET" 2>"$tmpdir/curl.err"; then
  printf "Failed to download openshell from GitHub:\n" >&2
  cat "$tmpdir/curl.err" >&2
  fail "Could not download $ASSET"
fi

# Validate the downloaded file is actually a gzip tarball
if ! file "$tmpdir/$ASSET" 2>/dev/null | grep -q "gzip compressed data"; then
  fail "Downloaded file is not a valid gzip tarball. GitHub may be unavailable or the release may be missing."
fi

# Try to download and verify checksum if available
CHECKSUM_URL="https://github.com/NVIDIA/OpenShell/releases/latest/download/SHA256SUMS"
if curl -fsSL "$CHECKSUM_URL" -o "$tmpdir/SHA256SUMS" 2>/dev/null; then
  # Checksum file exists, verify it
  # Use grep -F for literal string matching (prevents regex injection)
  if ! grep -qF "$ASSET" "$tmpdir/SHA256SUMS"; then
    printf "Warning: Checksum not found for %s in SHA256SUMS\n" "$ASSET" >&2
  else
    # Verify checksum in a subshell to avoid changing directory
    if ! (cd "$tmpdir" && grep -F "$ASSET" SHA256SUMS | shasum -a 256 -c -s); then
      fail "Checksum verification failed for $ASSET. File may be corrupted or tampered with."
    fi
    printf "✓ Checksum verified\n"
  fi
else
  printf "Warning: No checksum file available, skipping integrity verification\n" >&2
fi

# Extract tarball
if ! tar xzf "$tmpdir/$ASSET" -C "$tmpdir" 2>"$tmpdir/tar.err"; then
  printf "Failed to extract tarball:\n" >&2
  cat "$tmpdir/tar.err" >&2
  fail "Could not extract $ASSET"
fi

# Verify the binary was extracted
if [ ! -f "$tmpdir/openshell" ]; then
  fail "Extracted tarball but openshell binary not found"
fi

# Verify it's an executable
if ! file "$tmpdir/openshell" | grep -qE "executable|Mach-O|ELF"; then
  fail "Extracted file is not a valid executable"
fi

# Install with sudo prompt if needed
if [ -w /usr/local/bin ]; then
  install -m 755 "$tmpdir/openshell" /usr/local/bin/openshell
else
  printf "Installing to /usr/local/bin (requires sudo)...\n"
  sudo install -m 755 "$tmpdir/openshell" /usr/local/bin/openshell
fi

printf "openshell %s\n" "$(openshell --version 2>&1 || echo 'installed')"
