# Shared configuration for all NemoClaw Nix modules.
# Pure data — no nixpkgs dependency.
rec {
  # Version pins — reference only; actual package selection is in flake.nix.
  # openclaw version is controlled by nixpkgs.
  nodeVersion = "22";
  pythonVersion = "314";
  nemoclawVersion = "0.1.0";

  # Container user
  user = {
    name = "sandbox";
    group = "sandbox";
    uid = 1000;
    gid = 1000;
    home = "/sandbox";
    shell = "/bin/bash";
  };

  # Filesystem paths
  paths = {
    pluginDir = "/opt/nemoclaw";
    blueprintDir = "/opt/nemoclaw-blueprint";
    openclawConfig = "/sandbox/.openclaw";
    openclawData = "/sandbox/.openclaw-data";
    nemoclawState = "/sandbox/.nemoclaw";
  };

  # Runtime defaults
  defaults = {
    model = "nvidia/nemotron-3-super-120b-a12b";
    chatUiUrl = "http://127.0.0.1:18789";
    gatewayPort = "8080";
  };

  # Directories under .openclaw-data that get symlinked into .openclaw
  openclawDataDirs = [
    "agents/main/agent"
    "extensions"
    "workspace"
    "skills"
    "hooks"
    "identity"
    "devices"
    "canvas"
    "cron"
  ];

  # Top-level symlink targets (derived from openclawDataDirs at the first path component)
  openclawSymlinks = builtins.attrNames (
    builtins.listToAttrs (
      map (d: {
        name = builtins.head (builtins.split "/" d);
        value = true;
      }) openclawDataDirs
    )
  );

  # Patterns excluded from the project source derivation (projectSrc).
  # Only build artifacts and nix infrastructure (evaluated before filtering).
  # Note: flake.nix and flake.lock are intentionally NOT excluded — changes
  # to locked inputs or build logic should invalidate the source hash.
  excludePatterns = [
    ".git"
    "node_modules"
    "dist"
    "__pycache__"
    "nix"
  ];
}
