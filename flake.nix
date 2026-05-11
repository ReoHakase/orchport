{
  description = "orchport";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "aarch64-darwin"
        "x86_64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];
      targetFor =
        system:
        {
          aarch64-darwin = "darwin-arm64";
          x86_64-darwin = "darwin-x64";
          aarch64-linux = "linux-arm64";
          x86_64-linux = "linux-x64-baseline";
        }
        .${system} or (throw "orchport: unsupported system ${system}");
      eachSystem = f:
        nixpkgs.lib.genAttrs systems (
          system:
          f {
            inherit system;
            pkgs = import nixpkgs { inherit system; };
          }
        );
      version = (builtins.fromJSON (builtins.readFile ./package.json)).version;
      hashes = builtins.fromJSON (builtins.readFile ./nix/release-hashes.json);
      packageFor =
        pkgs: system:
        let
          target = targetFor system;
        in
        pkgs.stdenvNoCC.mkDerivation {
          pname = "orchport";
          inherit version;

          src = pkgs.fetchurl {
            url = "https://github.com/ReoHakase/orchport/releases/download/v${version}/orchport-v${version}-${target}.tar.gz";
            hash = hashes.${target} or pkgs.lib.fakeHash;
          };

          sourceRoot = ".";

          installPhase = ''
            runHook preInstall
            install -Dm755 orchport "$out/bin/orchport"
            runHook postInstall
          '';

          meta = {
            description = "Non-interactive env and port resolver for local multi-worktree web development";
            homepage = "https://github.com/ReoHakase/orchport";
            license = pkgs.lib.licenses.mit;
            mainProgram = "orchport";
            platforms = systems;
          };
        };
    in
    {
      packages = eachSystem (
        { pkgs, system }:
        rec {
          orchport = packageFor pkgs system;
          default = orchport;
        }
      );

      apps = eachSystem (
        { system, ... }:
        {
          orchport = {
            type = "app";
            program = "${self.packages.${system}.orchport}/bin/orchport";
          };
          default = self.apps.${system}.orchport;
        }
      );

      overlays.default = final: _prev: {
        orchport = packageFor final final.stdenv.hostPlatform.system;
      };
    };
}
