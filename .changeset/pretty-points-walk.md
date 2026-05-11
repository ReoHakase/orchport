---
"orchport": minor
---

Release the first public version of Orchport: a non-interactive port, URL, and environment resolver for local multi-worktree web development.

This release includes deterministic proxy port resolution, readable `*.localhost` URLs, `ORCHPORT_*` environment injection, local reverse proxy support with development TLS, switchable OAuth callback routing across worktrees, and state inspection commands for agent-friendly workflows.

It also adds the release distribution pipeline: npm publishes a small shim that installs the precompiled Bun single-file executable from GitHub Releases, while the Nix flake packages the same verified release binaries.

Release notes are generated with the GitHub changelog plugin so Version PR changelogs include repository links, and agent-facing adoption docs are included through README guidance and the public `orchport` Agent Skill for downstream project setup.
