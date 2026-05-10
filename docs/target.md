# orchport 想定使用環境（参照: enterprise-agentic-saas-starter）

## orchport とは

**orchport** は、**ローカルの subagents と git worktree 上で Web 開発するとき**に、複数の dev server の **ポート衝突を避け**、**URL の可読性を高める**ための **非対話 CLI** を想定する。

このドキュメントは、その CLI が扱う **典型的な monorepo・マルチプロセス開発**の一例として、本リポジトリ（Bun + Turbo + portless 併用）の構成を整理したものである。実装名が `portless` であっても、**サブドメイン付き HTTPS とプロキシ先ポートの分離**という目的は orchport と同系統として読み替えられる。

**（任意）長寿命プロキシ**: 標準は `orchport run` がプロセス内でリバースプロキシを立ち上げる。特権ポートや単一プロキシを常駐させたい場合は **`sudo orchport proxy up`**（`mode: local-proxy`）、停止は **`orchport proxy down`**、状態は **`orchport proxy status`**。

---

## Monorepo のディレクトリ構成

```
enterprise-agentic-saas-starter/
├── apps/
│   ├── api/          # Elysia（Better Auth マウント含む）
│   └── web/          # Next.js
├── packages/
│   ├── auth/         # Better Auth 設定（ライブラリ、単体では HTTP なし）
│   ├── db/           # Drizzle / schema / seed / Turso ローカル
│   ├── email/        # React Email（preview 用 dev）
│   ├── ui/           # 共有 UI
│   └── typescript-config/
├── turbo.json
└── package.json      # workspaces: apps/*, packages/*
```

**ワークスペース**: Bun workspaces（`apps/*`, `packages/*`）。依存バージョンの多くはルート `package.json` の `catalog` で一元管理。

---

## turbo.json の要点（CLI が `turbo dev` 等を叩くときの前提）

| 項目         | 内容                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------ |
| ビルド依存   | `build` / `lint` / `format` / `test` / `typecheck` は `dependsOn: ["^…"]` で依存パッケージから順に実行                   |
| 成果物       | `@enterprise-agentic-saas/web#build` → `.next/**`（`!.next/cache/**`）、`@enterprise-agentic-saas/api#build` → `dist/**` |
| 長時間タスク | `dev` / `dev:portless`: `cache: false`, `persistent: true`                                                               |
| DB           | `@enterprise-agentic-saas/db#dev` は `with: ["@enterprise-agentic-saas/db#db:turso"]` で Turso ローカルと同時起動        |

---

## パッケージ名・URL・ポート（想定 dev 環境）

worktree や agent ごとに **ベースドメインやポートをずらす**場合、下表の **Portless / 公開 URL / 実 listen ポート**をまとめて orchport 側で割り当てる想定にできる。

| パッケージ名                                 | パス                         | Portless 名（`package.json` の `portless.name`） | 公開 URL の慣例（dev）                            | ポート / 備考                                               |
| -------------------------------------------- | ---------------------------- | ------------------------------------------------ | ------------------------------------------------- | ----------------------------------------------------------- |
| `@enterprise-agentic-saas/web`               | `apps/web`                   | `enterprise-agentic-saas`                        | `https://enterprise-agentic-saas.localhost`       | `portless run next dev --turbopack`。実ポートはプロキシ背後 |
| `@enterprise-agentic-saas/api`               | `apps/api`                   | `api.enterprise-agentic-saas`                    | `https://api.enterprise-agentic-saas.localhost`   | 環境変数 `PORT` 未設定時 **3001** で `listen`               |
| `@enterprise-agentic-saas/db`                | `packages/db`                | `db.enterprise-agentic-saas`                     | `https://db.enterprise-agentic-saas.localhost`    | `turso dev` は `PORT` 未設定時 **8080**（`db:turso:serve`） |
| `@enterprise-agentic-saas/email`             | `packages/email`             | `email.enterprise-agentic-saas`                  | `https://email.enterprise-agentic-saas.localhost` | `portless run` 内で `$PORT` を react-email に渡す           |
| `@enterprise-agentic-saas/auth`              | `packages/auth`              | —                                                | —                                                 | ライブラリ。HTTP は API 上にマウント                        |
| `@enterprise-agentic-saas/ui`                | `packages/ui`                | —                                                | —                                                 | ライブラリのみ                                              |
| `@enterprise-agentic-saas/typescript-config` | `packages/typescript-config` | —                                                | —                                                 | TS 設定共有のみ                                             |

**フロント → API**: `NEXT_PUBLIC_API_BASE_URL`（未設定時のコード上デフォルトは `https://api.enterprise-agentic-saas.localhost`）。

**API 環境のフォールバック**: `API_PUBLIC_URL` 未指定時は `http://localhost:${PORT}`（`PORT` 既定 3001）。worktree では `.env` で HTTPS の公開 URL を明示する運用が安全。

---

## 環境変数（API / 認証の境界）

`apps/api/.env.example` が全体のつなぎを示す。orchport でホスト名やポートを変える場合、少なくとも次を **一貫して**更新する。

| 変数                       | 役割                                                            |
| -------------------------- | --------------------------------------------------------------- |
| `APP_BASE_URL`             | Web アプリのオリジン（CORS デフォルトの基準にもなる）           |
| `NEXT_PUBLIC_API_BASE_URL` | ブラウザから見た API（＋ Better Auth クライアントの `baseURL`） |
| `API_PUBLIC_URL`           | API の外向き URL                                                |
| `BETTER_AUTH_URL`          | Better Auth の `baseURL`（通常は API の公開 URL と一致）        |
| `TRUSTED_ORIGINS`          | カンマ区切り。Web のオリジンを含める                            |
| `CORS_ORIGIN`              | カンマ区切り。未設定時は `APP_BASE_URL` 由来                    |
| `TURSO_DATABASE_URL`       | libSQL / Turso（例では `db.*.localhost`）                       |
| `PORT`                     | API の実 listen ポート                                          |

**TLS / CA**: `packages/db` のスクリプト等では `NODE_EXTRA_CA_CERTS` を `~/.portless/ca.pem` にフォールバックする例がある。orchport の **`orchport run`**（プロキシが TLS のとき）は子プロセスに **`ORCHPORT_DEV_TLS_CERT_FILE`**（サーバ証明書 PEM のパス）を渡し、親で未設定なら **`NODE_EXTRA_CA_CERTS`**（Node/Bun）と **`DENO_CERT`**（Deno）も同じ PEM に設定する。`orchport env` だけでは PEM が無いのでこれらは出ない。社内 CA と併用する場合は既存の `NODE_EXTRA_CA_CERTS` / `DENO_CERT` は上書きされないため、手動マージが必要。追加の標準 HTTPS ポートがバインドできず **`ORCHPORT_*_URL`** がメイン TLS ポートに書き換わるとき、`env` で **`${entries.*.url}` と同一文字列だった値**（例: `TURSO_DATABASE_URL`）も **`run` が同じ新しい URL に追従**する（カスタム `url` 関数は対象外）。

---

## OAuth / コールバック（Better Auth）

- サーバ設定: `packages/auth` で `baseURL: BETTER_AUTH_URL`、`basePath: "/auth"`、`trustedOrigins: TRUSTED_ORIGINS`。GitHub は `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`。
- **OAuth のリダイレクト URI** は `BETTER_AUTH_URL` 上の **`/auth/...`**（Better Auth 標準パス）に合わせる。
- フロントのソーシャルサインイン等では `createAuthCallbackURL` が **`window.location.origin` 基準**で戻り先を絶対 URL にしているため、**Web の公開オリジン**と `TRUSTED_ORIGINS` / GitHub アプリ設定の整合が必要。

---

## CLI 設計メモ（このリポジトリから抽出した要件）

1. **複数プロセス**: `web` / `api` / `db`（Turso）/ `email` preview が同時に動きうる。worktree ごとに **実ポートと表示用ホスト**を束ねる。
2. **非対話**: CI・subagent・スクリプトから `turbo dev` や個別 `dev` を起動する前提。
3. **環境の一貫性**: ホスト名を変えたら `APP_BASE_URL` / `NEXT_PUBLIC_API_BASE_URL` / `BETTER_AUTH_URL` / `TRUSTED_ORIGINS` / `CORS_ORIGIN` / `TURSO_DATABASE_URL` をセットで追従させるとよい。

---

## orchport での再現（このリポジトリの CLI）

上記の変数束ねは **orchport** の設定 `env` でテンプレート化できる。サンプルは [test/e2e/fixtures/target-like-yaml/orchport.yaml](test/e2e/fixtures/target-like-yaml/orchport.yaml)（同等の JSON / TS は `target-like-json` / `target-like-ts`）。ルートで `orchport run -- turbo dev` のように叩く。ラップするコマンドに **`--` 以降**で `-` 付きオプションを渡す（例: `orchport run -- pnpm exec vite --port $ORCHPORT_WEB_PORT`）。state や run 記録の置き場は `ORCHPORT_STATE_DIR` または XDG 準拠の `~/.local/state/orchport`。

人間向け出力は `env` / `list` / `switch` / `doctor` で状態記号と次アクションを出す。script では `env <proxy> --json` / `--shell` / `--dotenv` / `--plain` を使う。`env` の proxy 未指定出力は `global` と各 proxy の section 表示で、`env <proxy>` は `run <proxy>` が注入する flat env を表示する。orchport が生成する `PORT` は proxy ごとの実 port で、config の `env.PORT` より優先される。

```txt
orchport env
mode local-proxy  workspace myapp  worktree main

global
Variable                  Value
───────────────────────────────────────────────────────────
ORCHPORT                  1
APP_BASE_URL              https://web.myapp.test

● api  https://api.myapp.test (→ http://localhost:8001)
Variable                  Value
───────────────────────────────────────────────────────────
PORT                      8001
ORCHPORT_API_URL          https://api.myapp.test
TURSO_DATABASE_URL        https://db.myapp.test
```

`switchables` がある場合、`list` / `switch` は安定した incoming URL と現在の転送先を表示する。

```txt
Switchable
https://api.myapp.test/auth/callback/* → http://localhost:8001/auth/callback/* (← https://api.fix-xxx.myapp.test/auth/callback/*)
```
