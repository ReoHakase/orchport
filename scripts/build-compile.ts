/**
 * macOS (especially Sequoia 15.4+): Bun can emit a broken embedded code signature
 * for `bun build --compile`, and the kernel SIGKILLs the binary (`zsh: killed`).
 * Workaround: compile with BUN_NO_CODESIGN_MACHO_BINARY=1, then ad-hoc codesign.
 * @see https://github.com/oven-sh/bun/issues/29306
 */
import { spawnSync } from "node:child_process";

const outfile = "./dist/orchport";

const env = { ...process.env };
if (process.platform === "darwin") {
  env.BUN_NO_CODESIGN_MACHO_BINARY = "1";
}

let r = spawnSync(
  "bun",
  ["build", "--compile", "./src/index.ts", "--outfile", outfile],
  { stdio: "inherit", env }
);
if (r.status !== 0) {
  process.exit(r.status ?? 1);
}

if (process.platform === "darwin") {
  r = spawnSync("codesign", ["--force", "--sign", "-", outfile], {
    stdio: "inherit",
  });
  process.exit(r.status ?? 0);
}
