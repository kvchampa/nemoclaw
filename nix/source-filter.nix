# Reusable source filtering for NemoClaw builds.
# Keeps derivations from rebuilding when unrelated files change.
{ lib, constants }:

let
  root = ./..;

  # Filter that excludes patterns listed in constants.excludePatterns
  excludeFilter =
    path: _type:
    let
      baseName = baseNameOf (toString path);
    in
    !builtins.elem baseName constants.excludePatterns;

  # Full project source minus excluded directories
  projectSrc = lib.cleanSourceWith {
    src = root;
    filter = excludeFilter;
    name = "nemoclaw-source";
  };

  # Sub-source filters are intentionally specific to each directory's build artifacts,
  # independent of constants.excludePatterns which covers the full project source.

  # Just the nemoclaw/ TypeScript plugin directory
  pluginSrc = lib.cleanSourceWith {
    src = root + "/nemoclaw";
    filter =
      path: type:
      let
        baseName = baseNameOf (toString path);
      in
      !builtins.elem baseName [
        "node_modules"
        "dist"
      ];
    name = "nemoclaw-plugin-source";
  };

  # Just the nemoclaw-blueprint/ directory
  blueprintSrc = lib.cleanSourceWith {
    src = root + "/nemoclaw-blueprint";
    filter =
      path: type:
      let
        baseName = baseNameOf (toString path);
      in
      !builtins.elem baseName [
        "__pycache__"
        ".ruff_cache"
      ];
    name = "nemoclaw-blueprint-source";
  };

  # Just the docs/ directory
  docsSrc = lib.cleanSourceWith {
    src = root + "/docs";
    filter =
      path: type:
      let
        baseName = baseNameOf (toString path);
      in
      !builtins.elem baseName [
        "_build"
        "__pycache__"
      ];
    name = "nemoclaw-docs-source";
  };

in
{
  inherit
    projectSrc
    pluginSrc
    blueprintSrc
    docsSrc
    ;
}
