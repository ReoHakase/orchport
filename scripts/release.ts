import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, join } from "node:path";

import { $ } from "bun";

type PackageJson = {
  name: string;
  version: string;
};

type CompileArgs = {
  outfile: string;
  target?: string;
};

type TargetKey =
  | "darwin-arm64"
  | "darwin-x64"
  | "linux-arm64"
  | "linux-x64-baseline";

type TargetMeta = {
  target: string;
  os: "darwin" | "linux";
  arch: "arm64" | "x64";
};

type ReleaseAsset = {
  file: string;
  target: string;
  os: "darwin" | "linux";
  arch: "arm64" | "x64";
  url: string;
  sha256: string;
};

const targetKeys: TargetKey[] = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64-baseline",
];

const targets: Record<TargetKey, TargetMeta> = {
  "darwin-arm64": {
    target: "bun-darwin-arm64",
    os: "darwin",
    arch: "arm64",
  },
  "darwin-x64": {
    target: "bun-darwin-x64",
    os: "darwin",
    arch: "x64",
  },
  "linux-arm64": {
    target: "bun-linux-arm64",
    os: "linux",
    arch: "arm64",
  },
  "linux-x64-baseline": {
    target: "bun-linux-x64-baseline",
    os: "linux",
    arch: "x64",
  },
};

const readPackage = (): PackageJson => {
  const raw: unknown = JSON.parse(readFileSync("package.json", "utf8"));
  if (
    raw &&
    typeof raw === "object" &&
    "name" in raw &&
    "version" in raw &&
    typeof raw.name === "string" &&
    typeof raw.version === "string"
  ) {
    return { name: raw.name, version: raw.version };
  }
  throw new Error("package.json must contain string name and version");
};

const parseCompileArgs = (argv: string[]): CompileArgs => {
  const args: CompileArgs = { outfile: "./dist/orchport" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--outfile") {
      args.outfile = argv.at(i + 1) ?? args.outfile;
      i += 1;
      continue;
    }
    if (arg.startsWith("--outfile=")) {
      args.outfile = arg.slice("--outfile=".length);
      continue;
    }
    if (arg === "--target") {
      args.target = argv.at(i + 1);
      i += 1;
      continue;
    }
    if (arg.startsWith("--target=")) {
      args.target = arg.slice("--target=".length);
    }
  }
  return args;
};

const parseTargetFilter = (argv: string[]): TargetKey[] => {
  const requested = argv
    .flatMap((arg, index, all) =>
      arg === "--target"
        ? [all.at(index + 1)]
        : arg.startsWith("--target=")
          ? [arg.slice("--target=".length)]
          : []
    )
    .filter((arg): arg is TargetKey => Boolean(arg));

  if (requested.length === 0) {
    return targetKeys;
  }

  for (const key of requested) {
    if (!(key in targets)) {
      throw new Error(`Unknown release target: ${key}`);
    }
  }
  return requested;
};

const compile = async (argv: string[]): Promise<void> => {
  const args = parseCompileArgs(argv);
  const compileOptions = args.target
    ? {
        outfile: args.outfile,
        target: args.target,
      }
    : {
        outfile: args.outfile,
      };
  const result = await Bun.build({
    entrypoints: ["./src/index.ts"],
    compile: compileOptions,
    define: {
      ORCHPORT_VERSION: JSON.stringify(readPackage().version),
    },
    target: "bun",
  });

  if (!result.success) {
    for (const log of result.logs) {
      console.error(log);
    }
    process.exit(1);
  }
};

const buildTarget = async (
  pkg: PackageJson,
  repo: string,
  releaseDir: string,
  workDir: string,
  key: TargetKey
): Promise<{ key: TargetKey; asset: ReleaseAsset; checksum: string }> => {
  const meta = targets[key];
  const versionTag = `v${pkg.version}`;
  const targetDir = join(workDir, key);
  const binaryPath = join(targetDir, "orchport");
  const file = `${pkg.name}-${versionTag}-${key}.tar.gz`;
  const archivePath = join(releaseDir, file);

  await mkdir(targetDir, { recursive: true });
  await compile(["--target", meta.target, "--outfile", binaryPath]);
  await chmod(binaryPath, 0o755);
  await $`tar -czf ${archivePath} -C ${targetDir} orchport`;

  const data = await readFile(archivePath);
  const sha256 = createHash("sha256").update(data).digest("hex");
  return {
    key,
    checksum: `${sha256}  ${basename(archivePath)}`,
    asset: {
      file,
      target: meta.target,
      os: meta.os,
      arch: meta.arch,
      url: `https://github.com/${repo}/releases/download/${versionTag}/${file}`,
      sha256,
    },
  };
};

const archive = async (argv: string[]): Promise<void> => {
  const repo = process.env.GITHUB_REPOSITORY ?? "ReoHakase/orchport";
  const pkg = readPackage();
  const releaseDir = "dist/release";
  const workDir = join(releaseDir, "work");
  const selectedTargets = parseTargetFilter(argv);

  await mkdir(releaseDir, { recursive: true });
  await rm(workDir, { recursive: true, force: true });

  const results = await Promise.all(
    selectedTargets.map((key) =>
      buildTarget(pkg, repo, releaseDir, workDir, key)
    )
  );
  const checksumLines = results.map((result) => result.checksum);
  const nixHashes = Object.fromEntries(
    results.map((result) => [
      result.key,
      `sha256-${Buffer.from(result.asset.sha256, "hex").toString("base64")}`,
    ])
  );

  await writeFile(
    join(releaseDir, "SHA256SUMS"),
    `${checksumLines.join("\n")}\n`
  );
  await writeFile(
    "nix/release-hashes.json",
    `${JSON.stringify(nixHashes, null, 2)}\n`
  );
  await rm(workDir, { recursive: true, force: true });
};

const publish = async (): Promise<void> => {
  const pkg = readPackage();
  const tag = `v${pkg.version}`;
  const releaseDir = "dist/release";

  const npmPublished =
    (await $`npm view ${pkg.name}@${pkg.version} version`.quiet().nothrow())
      .exitCode === 0;

  if (npmPublished) {
    console.log(
      `${pkg.name}@${pkg.version} is already published; skipping release.`
    );
    return;
  }

  await archive([]);

  const remoteTagExists =
    (await $`git ls-remote --exit-code --tags origin ${tag}`.quiet().nothrow())
      .exitCode === 0;

  if (!remoteTagExists) {
    const localTagExists =
      (await $`git rev-parse --verify refs/tags/${tag}`.quiet().nothrow())
        .exitCode === 0;
    if (!localTagExists) {
      await $`git tag -a ${tag} -m ${`Release ${tag}`}`;
    }
    await $`git push origin ${tag}`;
  }

  const releaseExists =
    (await $`gh release view ${tag}`.quiet().nothrow()).exitCode === 0;

  if (!releaseExists) {
    await $`gh release create ${tag} --title ${tag} --notes-from-tag`;
  }

  const releaseFiles = (await readdir(releaseDir))
    .filter((file) => file.endsWith(".tar.gz") || file === "SHA256SUMS")
    .map((file) => join(releaseDir, file));

  await $`gh release upload ${tag} --clobber ${releaseFiles}`;
  await $`bun changeset publish`;

  const metadataStatus = await $`git status --short nix/release-hashes.json`
    .quiet()
    .text();

  if (
    process.env.GITHUB_ACTIONS === "true" &&
    metadataStatus.trim().length > 0
  ) {
    await $`git config user.name github-actions[bot]`;
    await $`git config user.email 41898282+github-actions[bot]@users.noreply.github.com`;
    await $`git add nix/release-hashes.json`;
    await $`git commit -m ${`chore(release): 🔖 update release metadata`} -m ${`Record generated release checksums for ${tag}.`}`;
    await $`git push origin HEAD:main`;
  }
};

const changesetStatus = async (argv: string[]): Promise<void> => {
  const base = argv.at(0) ?? "origin/main";
  const diff = await $`git diff --name-only ${base}...HEAD`.text();
  const changed = diff
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const docsOnlyPrefixes = [
    ".github/",
    "docs/",
    "test/",
    ".agents/",
    ".changeset/",
  ];
  const docsOnlyFiles = new Set([
    "AGENTS.md",
    "README.md",
    "CHANGELOG.md",
    "LICENSE",
  ]);
  const versionPrFiles = new Set(["package.json", "bun.lock", "CHANGELOG.md"]);
  const looksLikeChangesetsVersionPr =
    changed.length > 0 &&
    changed.every(
      (path) => versionPrFiles.has(path) || path.startsWith(".changeset/")
    );

  if (looksLikeChangesetsVersionPr) {
    console.log("Version PR metadata changed; skipping changeset status.");
    return;
  }

  const requiresChangeset = changed.some(
    (path) =>
      !docsOnlyFiles.has(path) &&
      !docsOnlyPrefixes.some((prefix) => path.startsWith(prefix))
  );

  if (!requiresChangeset) {
    console.log(
      "Only docs, tests, CI, or changeset metadata changed; skipping changeset status."
    );
    return;
  }

  await $`bun changeset status --since ${base}`;
};

const [command, ...args] = Bun.argv.slice(2);

if (command === "compile") {
  await compile(args);
} else if (command === "archive") {
  await archive(args);
} else if (command === "publish") {
  await publish();
} else if (command === "changeset-status") {
  await changesetStatus(args);
} else {
  console.error(
    "Usage: bun run scripts/release.ts <compile|archive|publish|changeset-status>"
  );
  process.exit(1);
}
