#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { chmod, copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { get } from "node:https";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vendorDir = join(root, "vendor");
const binaryName = process.platform === "win32" ? "orchport.exe" : "orchport";
const targetBinary = join(vendorDir, binaryName);
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const version = pkg.version;
const repository =
  typeof pkg.repository?.url === "string"
    ? pkg.repository.url
        .replace(/^git\+/, "")
        .replace(/^https:\/\/github\.com\//, "")
        .replace(/\.git$/, "")
    : "ReoHakase/orchport";

const isSourceCheckout =
  existsSync(join(root, ".git")) && existsSync(join(root, "src", "index.ts"));

if (
  process.env.ORCHPORT_FORCE_BINARY_INSTALL !== "1" &&
  (isSourceCheckout || process.env.ORCHPORT_SKIP_BINARY_INSTALL === "1")
) {
  process.exit(0);
}

const platformKey = (() => {
  if (process.platform === "darwin" && process.arch === "arm64") {
    return "darwin-arm64";
  }
  if (process.platform === "darwin" && process.arch === "x64") {
    return "darwin-x64";
  }
  if (process.platform === "linux" && process.arch === "arm64") {
    return "linux-arm64";
  }
  if (process.platform === "linux" && process.arch === "x64") {
    return "linux-x64-baseline";
  }
  return null;
})();

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

await mkdir(vendorDir, { recursive: true });

const localBinary = process.env.ORCHPORT_INSTALL_BINARY_FROM;
if (localBinary) {
  await copyFile(localBinary, targetBinary);
  await chmod(targetBinary, 0o755);
  process.exit(0);
}

if (platformKey === null) {
  fail(
    `No orchport binary is published for ${process.platform}/${process.arch}.`
  );
}

if (typeof version !== "string" || version.length === 0) {
  fail("package.json version must be a string.");
}

const archivePath = join(vendorDir, `${platformKey}.tar.gz`);
const extractDir = join(vendorDir, platformKey);
const file = `orchport-v${version}-${platformKey}.tar.gz`;
const releaseBase = `https://github.com/${repository}/releases/download/v${version}`;
const checksumsUrl = `${releaseBase}/SHA256SUMS`;
const archiveUrl = `${releaseBase}/${file}`;

const download = (url, destination) =>
  new Promise((resolve, reject) => {
    const request = get(url, (response) => {
      if (
        response.statusCode &&
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        download(response.headers.location, destination).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`download failed with HTTP ${response.statusCode}`));
        return;
      }
      pipeline(response, createWriteStream(destination)).then(resolve, reject);
    });
    request.on("error", reject);
  });

const checksumsPath = join(vendorDir, "SHA256SUMS");
await download(checksumsUrl, checksumsPath);
const checksums = await readFile(checksumsPath, "utf8");
const expected = checksums
  .split("\n")
  .map((line) => line.trim().split(/\s+/))
  .find((parts) => parts.at(1) === file)
  ?.at(0);

if (!expected) {
  fail(`SHA256SUMS has no entry for ${file}.`);
}

await download(archiveUrl, archivePath);

const data = await readFile(archivePath);
const sha256 = createHash("sha256").update(data).digest("hex");
if (sha256 !== expected) {
  fail(`sha256 mismatch for ${file}: expected ${expected}, got ${sha256}`);
}

await rm(extractDir, { recursive: true, force: true });
await mkdir(extractDir, { recursive: true });
const tar = spawnSync("tar", ["-xzf", archivePath, "-C", extractDir], {
  stdio: "inherit",
});
if (tar.status !== 0) {
  fail("failed to extract orchport binary archive");
}
await copyFile(join(extractDir, binaryName), targetBinary);
await chmod(targetBinary, 0o755);
await rm(archivePath, { force: true });
await rm(checksumsPath, { force: true });
await rm(extractDir, { recursive: true, force: true });
