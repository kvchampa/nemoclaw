# Quick start:
#
#   nix build                        Build the NemoClaw package (default)
#   nix run                          Show NemoClaw CLI help
#   nix run .# -- onboard            Configure inference endpoint and credentials
#   nix develop                      Enter the dev shell
#
#   nix build .#container            Build the OCI container image (creates ./result)
#   docker load < result             Load it into Docker
#   docker run --rm -it nemoclaw:0.1.0                  Run (starts nemoclaw-start)
#   docker run --rm -it --entrypoint /bin/bash nemoclaw:0.1.0   Interactive shell
#
#   nix run .#container-test         Run container smoke tests (requires Docker)
#   nix build .#docs                 Build Sphinx documentation
#   nix fmt                          Format all Nix files
#
{
  description = "NemoClaw — run OpenClaw inside OpenShell with NVIDIA inference";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs {
          inherit system;
          # openclaw is an autonomous AI agent marked insecure in nixpkgs because
          # it can execute arbitrary code. Acceptable here: NemoClaw is itself an
          # openclaw extension that requires the CLI, and the container runs sandboxed.
          config.permittedInsecurePackages = [
            "openclaw-2026.3.12"
          ];
        };

        # Pure data — no pkgs needed
        constants = import ./nix/constants.nix;

        # Centralized runtime dependencies (single source of truth)
        nodejs = pkgs.nodejs_22;
        python = pkgs.python314.withPackages (ps: [ ps.pyyaml ]);

        # Source filters
        sources = pkgs.callPackage ./nix/source-filter.nix { inherit constants; };

        # OpenClaw CLI from nixpkgs
        openclaw = pkgs.openclaw;

        # NemoClaw package (TS plugin + assembly)
        nemoclaw = pkgs.callPackage ./nix/package.nix {
          inherit
            constants
            sources
            openclaw
            nodejs
            python
            ;
        };

        # OCI container image
        container = pkgs.callPackage ./nix/container.nix {
          inherit
            constants
            nemoclaw
            openclaw
            nodejs
            python
            ;
        };

        # Documentation (best-effort, uses its own Python with Sphinx packages)
        docs = pkgs.callPackage ./nix/docs.nix { inherit constants sources; };

        # Container smoke-test script
        container-test = pkgs.callPackage ./nix/container-test.nix {
          inherit constants container;
          docker = pkgs.docker-client;
        };

      in
      {
        packages = {
          default = nemoclaw;
          inherit
            nemoclaw
            openclaw
            container
            container-test
            docs
            ;
        };

        devShells.default = pkgs.callPackage ./nix/shell.nix {
          inherit nemoclaw nodejs python;
        };

        formatter = pkgs.nixfmt;

        checks = {
          inherit nemoclaw;
          shell = self.devShells.${system}.default;
          # Requires Docker; uncomment for CI environments with Docker available:
          # inherit container-test;
        };
      }
    );
}
