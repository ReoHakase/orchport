---
"orchport": patch
---

Improve first-run ergonomics: `orchport` now prints help when run without a subcommand, `orchport init` defaults to `orchport.config.ts`, and the npm shim explains how Bun users should run `bun pm trust orchport` so the postinstall binary download can run.
