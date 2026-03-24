# NemoClaw Nix Infrastructure

Modular Nix flake for building, developing, and containerizing NemoClaw.

## What is Nix?

[Nix](https://nixos.org) is a package manager that provides **reproducible, isolated**
environments. It tracks all dependencies and pins exact versions so every developer
gets the same toolchain — no more "it worked on my machine". Nix packages live in
`/nix/store/` and do not interfere with your system packages. When you exit the
Nix shell, everything goes back to normal.

## Quick Start

### 1. Install Nix

If you don't have Nix installed, grab it from <https://nixos.org/download/>.

**Multi-user install** (recommended):

```bash
bash <(curl -L https://nixos.org/nix/install) --daemon
```

**Single-user install** (no root required):

```bash
bash <(curl -L https://nixos.org/nix/install) --no-daemon
```

#### Video Tutorials

| Platform | Video |
|----------|-------|
| Ubuntu | [Installing Nix on Ubuntu](https://youtu.be/cb7BBZLhuUY) |
| Fedora | [Installing Nix on Fedora](https://youtu.be/RvaTxMa4IiY) |

### 2. Enable Flakes

NemoClaw uses Nix **flakes**, which are still marked "experimental" in Nix.
You can enable them per-command or permanently.

**Per-command** (no config changes needed):

```bash
nix --extra-experimental-features 'nix-command flakes' develop
```

**Permanently** (recommended — add once, forget about it):

```bash
# Create the config directory if it doesn't exist
test -d /etc/nix || sudo mkdir /etc/nix

# Enable flakes
echo 'experimental-features = nix-command flakes' | sudo tee -a /etc/nix/nix.conf
```

After that, all `nix` commands work without the extra flag. See also the
[Nix Flakes wiki page](https://nixos.wiki/wiki/flakes).

### 3. Build and Develop

All commands below assume flakes are enabled. If not, prepend
`--extra-experimental-features 'nix-command flakes'` to each `nix` command.

```bash
# Enter dev shell with all build/lint/test tools
nix develop

# Build NemoClaw package
nix build

# Build OpenClaw CLI (from nixpkgs)
nix build .#openclaw

# Build OCI container image
nix build .#container

# Smoke-test the container (requires Docker daemon)
nix run .#container-test

# Build documentation (best-effort, may need extra packages)
nix build .#docs
```

### First Run

On the first run, Nix downloads and builds all dependencies — this can take
several minutes. Subsequent runs reuse the cache in `/nix/store/` and are
nearly instant.

Nix will **not** touch your system packages. Everything is isolated and
disappears when you exit the shell.

## Container Usage

### Image Size

| Metric | Size |
|--------|------|
| Compressed tarball (`result`) | ~1.1 GiB |
| Uncompressed (Docker) | ~3.1 GiB |

The image uses `dockerTools.buildLayeredImage` with 120 max layers for
efficient Docker layer caching. Most of the size comes from Node.js, Python,
Git, and the OpenClaw CLI.

### Smoke Test

```bash
# Build, load, and run 27 structural checks (requires Docker daemon)
nix run .#container-test
```

The test verifies: binaries on PATH, Node.js version, filesystem layout
(sandbox home, `.openclaw`/`.openclaw-data` split, plugin dir, blueprints),
symlink integrity, user/group IDs, container entrypoint, SSL certs, and Python packages.

### Manual Usage

```bash
# Build and load into Docker
nix build .#container
docker load < result

# Run (starts nemoclaw-start entrypoint by default)
docker run --rm -it nemoclaw:0.1.0

# Run with custom model and API key
docker run --rm -it \
  -e NEMOCLAW_MODEL=nvidia/nemotron-3-super-120b-a12b \
  -e NVIDIA_API_KEY=your-key \
  -e CHAT_UI_URL=http://127.0.0.1:18789 \
  -p 18789:18789 \
  nemoclaw:0.1.0

# Interactive shell (override entrypoint)
docker run --rm -it --entrypoint /bin/bash nemoclaw:0.1.0
```

### Running with Nix

```bash
# Show CLI help
nix run

# Run a subcommand (note the .# -- syntax)
nix run .# -- onboard
nix run .# -- list
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NEMOCLAW_MODEL` | `nvidia/nemotron-3-super-120b-a12b` | Inference model |
| `CHAT_UI_URL` | `http://127.0.0.1:18789` | Chat UI origin |
| `NVIDIA_API_KEY` | (none) | API key for NVIDIA-hosted inference |

## Architecture

```text
flake.nix                    # Coordinator — imports from ./nix/
  |
  +-- nix/constants.nix      # Pure data: versions, paths, user config
  +-- nix/source-filter.nix  # Filtered sources for reproducible builds
  +-- nix/package.nix        # NemoClaw: TS plugin build + assembly
  +-- nix/shell.nix          # Dev shell (mkShell + inputsFrom)
  +-- nix/container.nix      # OCI image (dockerTools.buildLayeredImage)
  +-- nix/container-test.nix # Container smoke tests (writeShellApplication)
  +-- nix/docs.nix           # Sphinx documentation build
```

OpenClaw comes directly from nixpkgs (`pkgs.openclaw`).

### Module Dependencies

```text
constants.nix --+---> source-filter.nix --+---> package.nix --+---> container.nix
                |                         |                   |
                |  pkgs.openclaw ---------+-------------------+
                |                         |                   |
                |                         +---> docs.nix      +---> shell.nix
                |
                +---> (all modules read constants)
```

## File Reference

| File | Purpose |
|------|---------|
| `constants.nix` | Shared config: versions, user, paths, defaults |
| `source-filter.nix` | `lib.cleanSourceWith` filters for each sub-project |
| `package.nix` | Two-phase build: `buildNpmPackage` (TS) + assembly |
| `shell.nix` | Dev shell via `mkShell` with `inputsFrom` |
| `container.nix` | OCI image via `dockerTools.buildLayeredImage` |
| `container-test.nix` | Container smoke tests via `writeShellApplication` |
| `docs.nix` | Sphinx documentation (best-effort) |

## Updating npm Hashes

When `nemoclaw/package-lock.json` changes, the `npmDepsHash` in `package.nix`
will become invalid. To update:

1. Set `npmDepsHash = lib.fakeHash;` in `nix/package.nix`
2. Run `nix build` — it will fail and print the correct hash
3. Replace `lib.fakeHash` with the printed hash

## Troubleshooting

**"error: experimental Nix feature 'flakes' is disabled"**

You haven't enabled flakes yet. Either pass the flag per-command:

```bash
nix --extra-experimental-features 'nix-command flakes' build
```

Or enable permanently (see [Enable Flakes](#2-enable-flakes) above).

**First build is slow**

This is expected. Nix is downloading and building all dependencies from
scratch. After the first build, everything is cached in `/nix/store/` and
rebuilds only what changed.

**"hash mismatch in fixed-output derivation"**

The npm dependency hash is stale. See [Updating npm Hashes](#updating-npm-hashes).

**Container test fails with "Cannot connect to the Docker daemon"**

The `container-test` target requires a running Docker daemon. Make sure Docker
is installed and your user is in the `docker` group (or use `sudo`).

## Design Decisions

- **`callPackage` for all modules** (except `constants.nix`) — auto-injects nixpkgs deps
- **Two-derivation package build** — plugin compiled separately, then assembled
- **OpenClaw from nixpkgs** — uses the upstream `pkgs.openclaw` package
- **Runtime config generation** — `openclaw.json` written by start script, not baked in
- **nixpkgs for standalone tools** (ruff, shellcheck); npm-local for version-locked devDeps
- **120-layer OCI image** — maximizes Docker layer cache efficiency
