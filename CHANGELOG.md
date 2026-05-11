# orchport

## 0.1.1

### Patch Changes

- [`5f04262`](https://github.com/ReoHakase/orchport/commit/5f042625dd96691941bdbb04077274576b96eec6) Thanks [@ReoHakase](https://github.com/ReoHakase)! - Improve first-run ergonomics: `orchport` now prints help when run without a subcommand, `orchport init` defaults to `orchport.config.ts`, and the npm shim explains how Bun users should run `bun pm trust orchport` so the postinstall binary download can run.

- [`f4fd489`](https://github.com/ReoHakase/orchport/commit/f4fd489a5a00eedc64d498a07a6617148d1decec) Thanks [@ReoHakase](https://github.com/ReoHakase)! - Harden CLI/runtime behavior around child argv forwarding, proxy URL rewriting, daemon TLS coverage, env script output, kill targeting, and cross-process port reservations.

## 0.1.0

### Minor Changes

- [`a3a571c`](https://github.com/ReoHakase/orchport/commit/a3a571c315dd68188a6bd6717abb24cfba46be31) Thanks [@ReoHakase](https://github.com/ReoHakase)! - Release the first public version of Orchport: a non-interactive port, URL, and environment resolver for local multi-worktree web development.

  This release includes deterministic proxy port resolution, readable `*.localhost` URLs, `ORCHPORT_*` environment injection, local reverse proxy support with development TLS, switchable OAuth callback routing across worktrees, and state inspection commands for agent-friendly workflows.

  It also adds the release distribution pipeline: npm publishes a small shim that installs the precompiled Bun single-file executable from GitHub Releases, while the Nix flake packages the same verified release binaries.

  Release notes are generated with the GitHub changelog plugin so Version PR changelogs include repository links, and agent-facing adoption docs are included through README guidance and the public `orchport` Agent Skill for downstream project setup.

## 0.1.0

### Patch Changes

- Initial public package baseline.
