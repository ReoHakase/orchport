---
name: changesets-release
description: Use when changing orchport release flow, npm publishing, GitHub Releases, Nix release hashes, CHANGELOG, or .changeset files. Guides Japanese-first Changesets usage in this repo, including when to add empty changesets and how to keep Conventional Commit separate from release intent.
---

# Changesets Release

orchport の release / changelog / publish まわりを変更するときはこの skill を読む。説明は日本語で書き、実装はこの repo の既存 script と Changesets の責務分担に合わせる。

## 基本方針

- Conventional Commit は履歴品質と commitlint のために使う。release bump / `CHANGELOG.md` / npm publish 判断は Changesets が担当する。
- `feat:` や `fix:` の commit だけでは release しない。ユーザー向け挙動、CLI、package、install、release、docs の公開面を変える PR には `.changeset/*.md` を追加する。
- release 不要の変更でも CI が changeset を要求する場合は、理由が明確なときだけ `bun changeset --empty` を使う。
- `CHANGELOG.md` は手で直接編集しない。`.changeset/*.md` を書き、Version PR の `changeset version` に生成させる。changelog は `@changesets/changelog-github` を使い、GitHub PR / commit links を付ける。
- npm package は single-binary shim 方式。runtime dependency を増やさず、`postinstall` は GitHub Release の tarball と `SHA256SUMS` から binary を入れる。
- Nix は GitHub Release tarball を使う。release 後に生成される `nix/release-hashes.json` を source of truth にする。
- Release workflow が Version PR 作成時に `GitHub Actions is not permitted to create or approve pull requests` を出した場合は、repo setting の `Allow GitHub Actions to create and approve pull requests` を有効化するか、生成済み `changeset-release/main` から PR を手動作成する。publish path の失敗は隠さない。

## 変更時の手順

1. 変更の種類を決める。
   - patch: bug fix、install/release script の互換修正、docs と実装の小さな同期。
   - minor: 新しい CLI 機能、配布経路、公開 API。
   - major: 既存 config / CLI / install contract の破壊的変更。
2. release 対象なら `bun changeset` で `.changeset/*.md` を追加する。
3. release 不要なら `bun changeset --empty` を使うか、CI の skip 対象だけに収まっているか確認する。
4. script 名は `package.json` の既存 contract を優先する。
   - `bun run build:compile`
   - `bun run release:archive`
   - `bun run release:publish`
   - `bun run changeset:status`
5. release script を触ったら、README と `docs/plan.md` / `docs/target.md` の install・release 記述も確認する。

## Version bump と npm publish の流れ

### ローカルで行うこと

1. リリース対象の変更に `.changeset/*.md` を用意する。
   - 対話作成: `bun changeset`
   - 既存 changeset の編集でもよい。
   - Conventional Commit の `feat:` / `fix:` だけでは release されない。
2. 次の version を確認する。
   - `bun changeset status`
   - 初回 `0.1.0` release は `package.json` を `0.0.0` にして、changeset を `minor` にする。
3. 変更を検証する。
   - `bun run format:check`
   - `bun run lint`
   - `bun run typecheck`
   - 必要に応じて `bun run test`
4. `.changeset/*.md` と関連変更を commit / push する。
   - commit message は Conventional Commit + Gitmoji。
   - `CHANGELOG.md` は手で編集しない。

ローカルで通常実行しないもの:

- `bun run version-packages`: Version PR で CI が実行する。
- `bun run release:publish`: tag push、GitHub Release 作成、asset upload、npm publish まで行うので通常は CI に任せる。

### CI で行われること

Release workflow は `main` への push で動く。

1. `.changeset/*.md` が残っている場合:
   - `changesets/action@v1` が `bun run version-packages` を実行する。
   - `package.json` version と `CHANGELOG.md` を更新する。
   - `.changeset/*.md` を消費する。
   - `chore(release): 🔖 version packages` の Version PR を作る。
   - repo setting が PR 作成を許可していない場合は、`changeset-release/main` branch から手動で PR を作る。
2. Version PR が merge され、`.changeset/*.md` が残っていない場合:
   - `changesets/action@v1` が `bun run release:publish` を実行する。
   - `scripts/release.ts publish` が `package.json` version から `vX.Y.Z` tag を決める。
   - `bun build --compile` の release tarball と `SHA256SUMS` を生成する。
   - `nix/release-hashes.json` を生成・更新する。
   - git tag を作成して push する。
   - GitHub Release を作成し、tarball と `SHA256SUMS` を upload する。
   - 最後に `bun changeset publish` で npm に publish する。
   - CI 上で `nix/release-hashes.json` に差分があれば、`chore(release): 🔖 update release metadata` として `main` に commit / push する。

CI に必要なもの:

- `NPM_TOKEN` repository secret。
- workflow permissions: `contents: write`, `pull-requests: write`, `id-token: write`。
- `@changesets/changelog-github` 用の `GITHUB_TOKEN`。Release workflow では `changesets/action` に渡している。
- npm provenance 用の `NPM_CONFIG_PROVENANCE=true`。

## 検証

- `bun run format:check`
- `bun run lint`
- `bun run typecheck`
- `bun changeset status`
- `bun run build`
- `bun run build:compile`
- `./dist/orchport --version`
- `npm_config_cache=/private/tmp/orchport-npm-cache npm pack --dry-run`
- `nix flake check --no-build path:/Users/ReoHakase/workspace/orchport`

`bun run test` が port probing で `No free port in range ...` を出す場合は、この環境の socket/bind 制約の可能性を切り分けてから release 変更の失敗と判断する。

## 注意点

- Homebrew 配布は現在 scope 外。brew / Formula を再追加しない。
- 追加ファイルは増やしすぎない。release 補助は `scripts/release.ts` に集約し、必要な npm install shim だけ `scripts/install-binary.mjs` に置く。
- placeholder の `release-manifest.json` や root `SHA256SUMS` は持たない。`SHA256SUMS` は GitHub Release asset として `dist/release/` に生成する。
- `flake.lock` は tracked file にしない。Nix check で生成されても `.gitignore` 対象。
