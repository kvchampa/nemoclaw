# OCI container image via dockerTools.buildLayeredImage.
# Replicates the Dockerfile layout: sandbox user, openclaw config/data split,
# plugin registration, and DAC lockdown.
{
  lib,
  dockerTools,
  runCommand,
  writeTextFile,
  bash,
  coreutils,
  findutils,
  cacert,
  git,
  curl,
  iproute2,
  constants,
  nemoclaw,
  openclaw,
  nodejs,
  python,
}:

let
  # Generate /etc/passwd and /etc/group entries
  passwdEntry = ''
    root:x:0:0:root:/root:/bin/bash
    ${constants.user.name}:x:${toString constants.user.uid}:${toString constants.user.gid}:${constants.user.name}:${constants.user.home}:${constants.user.shell}
  '';

  groupEntry = ''
    root:x:0:
    ${constants.user.group}:x:${toString constants.user.gid}:
  '';

  passwd = writeTextFile {
    name = "passwd";
    text = passwdEntry;
  };
  group = writeTextFile {
    name = "group";
    text = groupEntry;
  };

  # Runtime config generator — writes openclaw.json on first run if missing.
  # This keeps the image reproducible (no secrets/tokens baked in).
  startScript = writeTextFile {
    name = "nemoclaw-start";
    executable = true;
    destination = "/usr/local/bin/nemoclaw-start";
    text = builtins.readFile ../scripts/nemoclaw-start.sh;
  };

  # Pre-populate the openclaw plugin registry so we don't need to run
  # `openclaw plugins install` at build time (which requires network).
  pluginRegistry = writeTextFile {
    name = "openclaw-plugins.json";
    text = builtins.toJSON {
      plugins = [
        {
          id = "nemoclaw";
          name = "NemoClaw";
          version = constants.nemoclawVersion;
          path = constants.paths.pluginDir;
          enabled = true;
        }
      ];
    };
  };

  # Filesystem layout derivation — creates the sandbox home directory tree
  sandboxFs = runCommand "nemoclaw-sandbox-fs" { } ''
    mkdir -p $out${constants.user.home}

    # .openclaw-data directories
    ${lib.concatMapStringsSep "\n" (
      d: "mkdir -p $out${constants.paths.openclawData}/${d}"
    ) constants.openclawDataDirs}

    # .openclaw directory with symlinks to .openclaw-data
    mkdir -p $out${constants.paths.openclawConfig}
    ${lib.concatMapStringsSep "\n" (
      d: "ln -s ${constants.paths.openclawData}/${d} $out${constants.paths.openclawConfig}/${d}"
    ) constants.openclawSymlinks}

    # update-check.json symlink
    touch $out${constants.paths.openclawData}/update-check.json
    ln -s ${constants.paths.openclawData}/update-check.json $out${constants.paths.openclawConfig}/update-check.json

    # Pre-populate plugin registry
    mkdir -p $out${constants.paths.openclawData}/extensions
    cp ${pluginRegistry} $out${constants.paths.openclawData}/extensions/plugins.json

    # Blueprint files
    mkdir -p $out${constants.paths.nemoclawState}/blueprints/${constants.nemoclawVersion}
    cp -r ${nemoclaw}/lib/nemoclaw-blueprint/* $out${constants.paths.nemoclawState}/blueprints/${constants.nemoclawVersion}/

    # Plugin files at /opt/nemoclaw
    mkdir -p $out${constants.paths.pluginDir}
    cp -r ${nemoclaw}/lib/nemoclaw/* $out${constants.paths.pluginDir}/
  '';

in
dockerTools.buildLayeredImage {
  name = "nemoclaw";
  tag = constants.nemoclawVersion;
  maxLayers = 120;

  contents = [
    bash
    coreutils
    findutils
    cacert
    nodejs
    python
    git
    curl
    iproute2
    openclaw
    nemoclaw
    sandboxFs
    startScript
  ];

  # Create passwd/group, set ownership, apply DAC lockdown
  fakeRootCommands = ''
    # /etc entries
    mkdir -p ./etc
    cp ${passwd} ./etc/passwd
    cp ${group}  ./etc/group

    # Sandbox user owns their home
    chown -R ${toString constants.user.uid}:${toString constants.user.gid} .${constants.user.home}

    # DAC lockdown: root owns .openclaw so sandbox user cannot modify config
    chown -R root:root .${constants.paths.openclawConfig}
    find .${constants.paths.openclawConfig} -type d -exec chmod 755 {} +
    find .${constants.paths.openclawConfig} -type f -exec chmod 644 {} +

    # .openclaw-data stays writable by sandbox user
    chown -R ${toString constants.user.uid}:${toString constants.user.gid} .${constants.paths.openclawData}

    # Start script
    chmod +x ./usr/local/bin/nemoclaw-start
  '';

  config = {
    Entrypoint = [ "/usr/local/bin/nemoclaw-start" ];
    Cmd = [ ];  # Override with: docker run --entrypoint /bin/bash ...
    User = "${toString constants.user.uid}:${toString constants.user.gid}";
    WorkingDir = constants.user.home;
    Env = [
      "NEMOCLAW_MODEL=${constants.defaults.model}"
      "CHAT_UI_URL=${constants.defaults.chatUiUrl}"
      "PATH=/usr/local/bin:/usr/bin:/bin:${
        lib.makeBinPath [
          nodejs
          python
          git
          curl
          openclaw
          nemoclaw
        ]
      }"
      "NODE_PATH=${nodejs}/lib/node_modules"
      "SSL_CERT_FILE=${cacert}/etc/ssl/certs/ca-bundle.crt"
    ];
  };
}
