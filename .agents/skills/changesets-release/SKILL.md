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
- `CHANGELOG.md` は手で直接編集しない。`.changeset/*.md` を書き、Version PR の `changeset version` に生成させる。
- npm package は single-binary shim 方式。runtime dependency を増やさず、`postinstall` は GitHub Release の tarball と `SHA256SUMS` から binary を入れる。
- Nix は GitHub Release tarball を使う。release 後に生成される `nix/release-hashes.json` を source of truth にする。

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
