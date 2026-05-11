#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const exe = process.platform === "win32" ? "orchport.exe" : "orchport";
const binary = process.env.ORCHPORT_BINARY_PATH ?? join(root, "vendor", exe);

if (!existsSync(binary)) {
  process.stderr.write(
    [
      "orchport binary is not installed.",
      "Run `npm rebuild orchport` or reinstall the package.",
      "Set ORCHPORT_BINARY_PATH to use a local binary override.",
      "",
    ].join("\n")
  );
  process.exit(1);
}

const result = spawnSync(binary, process.argv.slice(2), {
  stdio: "inherit",
});

if (result.error) {
  process.stderr.write(`${result.error.message}\n`);
  process.exit(1);
}

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.exit(result.signal === null ? 0 : 1);
