# Sphinx documentation build (best-effort).
# nvidia-sphinx-theme and sphinx-llm may not be in nixpkgs yet;
# add buildPythonPackage stubs for them when needed.
{
  lib,
  stdenv,
  python314,
  constants,
  sources,
}:

let
  python = python314.withPackages (ps: [
    ps.sphinx
    ps.myst-parser
    ps.sphinx-copybutton
    ps.sphinx-design
    ps.sphinxcontrib-mermaid
    # TODO: package nvidia-sphinx-theme and sphinx-llm for nixpkgs
    # ps.nvidia-sphinx-theme
    # ps.sphinx-llm
  ]);

in
stdenv.mkDerivation {
  pname = "nemoclaw-docs";
  version = constants.nemoclawVersion;
  src = sources.docsSrc;

  nativeBuildInputs = [ python ];

  buildPhase = ''
    runHook preBuild
    sphinx-build -W -b html . $out/html
    runHook postBuild
  '';

  # sphinx-build outputs directly to $out/html
  dontInstall = true;

  meta = {
    description = "NemoClaw documentation (HTML)";
    license = lib.licenses.asl20;
  };
}
