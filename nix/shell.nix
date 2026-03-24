# Dev shell with all build, lint, and test tools.
{
  mkShell,
  gnumake,
  git,
  curl,
  shellcheck,
  shfmt,
  hadolint,
  ruff,
  pyright,
  nemoclaw,
  nodejs,
  python,
}:

mkShell {
  # Inherit build dependencies from the nemoclaw package
  inputsFrom = [ nemoclaw ];

  packages = [
    # Core
    nodejs
    python
    gnumake
    git
    curl

    # Linters / formatters (standalone binaries from nixpkgs)
    shellcheck
    shfmt
    hadolint
    ruff
    pyright
  ];

  shellHook = ''
    echo "NemoClaw dev shell"
    echo "  node:       $(node --version)"
    echo "  python:     $(python3 --version)"
    echo "  ruff:       $(ruff --version)"
    echo "  shellcheck: $(shellcheck --version | head -2 | tail -1)"
    echo ""
    echo "Quick start:"
    echo "  npm install          — install JS dependencies"
    echo "  cd nemoclaw && npm run build  — compile TS plugin"
    echo "  npm test             — run test suite"
    echo "  nix build            — build nemoclaw package"
    echo "  nix build .#container — build OCI container image"
  '';
}
