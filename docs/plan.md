# orchport 要件・設計

## 目的

orchport は、**local の subagents + git worktree 環境でWeb開発するときに、複数dev serverのport衝突を避け、URLの可読性を高めるための非対話CLI**。

主な利用シーンはこれです。

```bash
orchport run turbo dev
orchport run bun run dev
orchport run pnpm dev
orchport run npm run dev
```

orchportはプロセスマネージャではなく、**実行前にport・URL・環境変数を生成して、指定されたコマンドに注入するcommand wrapper** として設計する。

## 非目標

やらないことを明確にする。

```txt
orchport up / down のような常駐型プロセスマネージャ
interactive TUI
sudo前提の443 bind
/etc/hosts の自動編集
.zshrc の無断編集
Turborepo / Bun / Node / TypeScript / Next.js 専用config
Tailscale / Funnel の初期実装
```

Tailscale/Funnelは **planned** として設計だけ残す。初期実装では入れない。

---

# コアUX

## 基本

```bash
orchport run <command...>
```

例:

```bash
orchport run turbo dev
orchport run turbo run dev --parallel
orchport run bun run dev
orchport run pnpm dev
orchport run node server.js
```

`orchport run` は以下を行う。

```txt
1. configを読む
2. workspace / worktree を解決する
3. entryごとにportを安定割り当てする
4. URLを生成する
5. env templateを解決する
6. 子プロセスへenvを注入する
7. 指定されたコマンドを実行する
8. signalとexit codeを透過する
```

## 補助コマンド

```bash
orchport env
orchport list
orchport kill
orchport init
orchport doctor
```

`orchport up` は作らない。

---

# 実行環境要件

必須条件。

```txt
sudoなしで動く
interactive TTYなしで動く
Codex/Cursor/subagent/sandbox環境で動く
CIでも動く
localhost:<port> fallbackが常に動く
```

つまり、最初の安定実装はこれ。

```txt
http://localhost:<auto-port>
```

`*.localhost` や443は便利機能として後から追加できるが、基本要件にしない。

---

# URL生成

## ビルトイン規則（既定）

`local-port` では実ポートで次を自動生成する（`worktreeHostPrefix` は origin デフォルトブランチ上では空）。

```txt
http://<entry>.<worktreeHostPrefix><workspace>.localhost:<entry.port>
```

例（feature ブランチ）:

```txt
http://web.feature-auth.acme.localhost:43101
```

`local-proxy` では同じホスト名で **プロキシ用ポート** を使う。

## TypeScript のみ `url` 関数で上書き

任意。省略時は上記ビルトイン。

```ts
import { defineConfig } from "orchport";

export default defineConfig({
  workspace: "acme",
  url: ({ entry, workspace, worktreeHostPrefix }) =>
    `http://${entry.name}.${worktreeHostPrefix}${workspace}.localhost:${entry.port}`,
  entries: {
    web: { port: "auto" },
    api: { port: "auto" },
    auth: { port: "auto", priority: "auth" },
  },
  env: ({ entries }) => ({
    ORCHPORT_WEB_PORT: entries.web.port,
    ORCHPORT_API_PORT: entries.api.port,
    ORCHPORT_AUTH_PORT: entries.auth.port,
    ORCHPORT_WEB_URL: entries.web.url,
    ORCHPORT_API_URL: entries.api.url,
    ORCHPORT_AUTH_URL: entries.auth.url,
    NEXT_PUBLIC_API_URL: entries.api.url,
    BETTER_AUTH_URL: entries.auth.url,
  }),
});
```

YAML/JSON に `url` キーはない（文字列テンプレートは廃止）。

---

# TypeScript config DX

TypeScript configは、型補完を強くする。

## 目標

```txt
entry名から entries.web.url / entries.api.port を型推論する
env関数内で存在しないentry名を型エラーにする
priorityなどはliteral unionで補完する
url関数の引数にentry/workspace/worktree/exposure modeを型付きで渡す
defineConfigで余計なキーを検出しやすくする
```

## API案

```ts
import { defineConfig, entry } from "orchport";

export default defineConfig({
  workspace: "acme",

  entries: {
    web: entry({
      port: "auto",
      role: ["web"],
    }),

    api: entry({
      port: "auto",
      role: ["api"],
    }),

    auth: entry({
      port: "auto",
      role: ["auth"],
      priority: "auth",
    }),
  },

  url: ({ entry, workspace, worktreeHostPrefix }) =>
    `http://${entry.name}.${worktreeHostPrefix}${workspace}.localhost:${entry.port}`,

  env: ({ entries }) => ({
    ORCHPORT_WEB_PORT: entries.web.port,
    ORCHPORT_WEB_URL: entries.web.url,

    ORCHPORT_API_PORT: entries.api.port,
    ORCHPORT_API_URL: entries.api.url,

    BETTER_AUTH_URL: entries.auth.url,
  }),
});
```

`entry()` は必須ではないが、型補完を強くするために提供する。

```ts
web: {
  port: "auto",
}
```

でも動くようにする。

## 型イメージ

```ts
type EntryConfig = {
  port?: "auto" | number;
  host?: string;
  protocol?: "http" | "https";
  subdomain?: string;
  priority?: "default" | "auth";
  role?: readonly ("web" | "api" | "auth" | "storybook" | "custom")[];
};

type ResolvedEntry<Name extends string = string> = {
  name: Name;
  port: number;
  host: string;
  url: string;
  localUrl: string;
};

type DefineConfigInput<Entries extends Record<string, EntryConfig>> = {
  workspace?: string;
  worktree?: string;

  entries: Entries;

  url?: (ctx: {
    entry: ResolvedEntry<Extract<keyof Entries, string>>;
    workspace: string;
    worktree: string;
    worktreeHostPrefix: string;
    mode: "local-port" | "local-proxy";
  }) => string;

  env?:
    | Record<string, string | number | boolean | null>
    | ((ctx: {
        entries: {
          [K in keyof Entries]: ResolvedEntry<Extract<K, string>>;
        };
        workspace: string;
        worktree: string;
        worktreeHostPrefix: string;
      }) => Record<string, string | number | boolean | null>);
};
```

これにより、TypeScript configでは `entries.web.url` が補完される。

---

# Config対応

## 対応形式

```txt
orchport.config.ts
orchport.config.mts
orchport.config.js
orchport.config.mjs
orchport.yaml
orchport.yml
orchport.json
package.json の orchport field
```

## 探索順

```txt
1. --config で指定されたpath
2. cwdから上に探索
3. orchport.config.ts
4. orchport.config.mts
5. orchport.config.js
6. orchport.config.mjs
7. orchport.yaml
8. orchport.yml
9. orchport.json
10. package.json#orchport
```

## YAML/JSON config

`env` の値だけ `${entries.*}` 等の補間可。URL はビルトイン規則。

```json
{
  "workspace": "acme",
  "entries": {
    "web": { "port": "auto" },
    "api": { "port": "auto" }
  },
  "env": {
    "ORCHPORT_WEB_PORT": "${entries.web.port}",
    "ORCHPORT_WEB_URL": "${entries.web.url}",
    "NEXT_PUBLIC_API_URL": "${entries.api.url}"
  }
}
```

---

# env生成

orchportは標準envとuser-defined envを生成する。

## 標準env

```env
ORCHPORT=1
ORCHPORT_VERSION=0.1.0
ORCHPORT_RUN_ID=01HX...
ORCHPORT_WORKSPACE=acme
ORCHPORT_WORKTREE=feature-auth
ORCHPORT_MODE=local-port
ORCHPORT_CONFIG=/path/to/orchport.config.ts
```

entryごとに自動生成。

```env
ORCHPORT_WEB_PORT=43101
ORCHPORT_WEB_HOST=localhost
ORCHPORT_WEB_URL=http://localhost:43101

ORCHPORT_API_PORT=43102
ORCHPORT_API_HOST=localhost
ORCHPORT_API_URL=http://localhost:43102
```

entry名は大文字snake caseに変換する。

```txt
web -> WEB
storybook -> STORYBOOK
admin-api -> ADMIN_API
```

## user-defined env

configの `env` で追加する。

```ts
env: ({ entries }) => ({
  NEXT_PUBLIC_API_URL: entries.api.url,
  BETTER_AUTH_URL: entries.auth.url,
  OAUTH_CALLBACK_URL: `${entries.auth.url}/api/auth/callback/google`,
});
```

衝突時はuser-defined envが標準envを上書きできるかを決める必要がある。

おすすめはこれ。

```txt
ORCHPORT_* は予約済みで上書き不可
それ以外はuser-defined envが優先
```

---

# port割り当て

## 要件

```txt
複数worktreeで衝突しない
複数subagentで同時実行しても衝突しにくい
同じworkspace/worktree/entryは同じportを再利用しやすい
使用中なら次の空きportへfallback
sudo不要
```

## デフォルト範囲

```txt
43100-43999
```

configで変更可能。

```ts
export default defineConfig({
  portRange: [43100, 43999],
});
```

## 安定割り当て

```txt
hash(workspace, worktree, entryName) -> preferred port
preferred portが空いていなければ線形探索
```

## lock

subagent同時実行に備えてlock fileを使う。

```txt
~/.local/state/orchport/locks/ports.lock
```

割り当て時はatomicに更新する。

```txt
~/.local/state/orchport/ports.json
```

---

# state管理

`list` と `kill` のためにstateを持つ。

```txt
~/.local/state/orchport/
  runs/
    <run-id>.json
  ports.json
  locks/
    ports.lock
```

run state例。

```json
{
  "runId": "01HX...",
  "rootPid": 12345,
  "command": ["turbo", "dev"],
  "workspace": "acme",
  "worktree": "feature-auth",
  "mode": "local-port",
  "createdAt": "2026-05-09T13:00:00.000Z",
  "entries": {
    "web": {
      "port": 43101,
      "url": "http://localhost:43101"
    },
    "api": {
      "port": 43102,
      "url": "http://localhost:43102"
    }
  }
}
```

---

# list

```bash
orchport list
orchport list --json
orchport list --stale
orchport list --workspace acme
orchport list --worktree feature-auth
```

出力例。

```txt
● web   http://localhost:43101   port 43101   pid 12345   running
● api   http://localhost:43102   port 43102   pid 12345   running
● auth  http://localhost:43103   port 43103   pid 12345   running
```

modern CLIとして、色とアイコンは使う。ただしCI/非TTYでは自動で無効化する。

```txt
TTY:     color + icons
non-TTY: plain text
--json:  machine-readable
--no-color: color disabled
```

---

# kill

```bash
orchport kill web
orchport kill api
orchport kill 43101
orchport kill http://localhost:43101
orchport kill --run-id 01HX...
orchport kill --pid 12345
orchport kill --all
orchport kill --stale
```

## 安全方針

デフォルトでは orchport が記録したroot pidだけkillする。

portを使っている外部プロセスは勝手にkillしない。

```txt
Port 43101 is used by PID 99999, but it was not started by orchport.
Use --force to kill it.
```

強制は明示。

```bash
orchport kill 43101 --force
```

signal指定。

```bash
orchport kill web --signal SIGTERM
orchport kill web --signal SIGKILL
```

---

# init

```bash
orchport init
orchport init --format ts
orchport init --format yaml
orchport init --format json
orchport init --yes
```

非interactiveなので、質問はしない。
既存ファイルがある場合は失敗する。上書きは `--force`。

```bash
orchport init --format ts --force
```

生成例。

```ts
import { defineConfig, entry } from "orchport";

export default defineConfig({
  workspace: "my-app",

  entries: {
    web: entry({ port: "auto" }),
    api: entry({ port: "auto" }),
    auth: entry({ port: "auto", priority: "auth" }),
  },

  url: ({ entry }) => `http://localhost:${entry.port}`,

  env: ({ entries }) => ({
    NEXT_PUBLIC_API_URL: entries.api.url,
    BETTER_AUTH_URL: entries.auth.url,
    OAUTH_CALLBACK_URL: `${entries.auth.url}/api/auth/callback/google`,
  }),
});
```

---

# env

```bash
orchport env
orchport env --json
orchport env --shell
orchport env --dotenv
```

`orchport env` はコマンドを実行せず、生成envだけ表示する。

```bash
eval "$(orchport env --shell)"
turbo dev
```

---

# nested ORCHPORT

`ORCHPORT=1`（移行期間は互換で小文字 `orchport=1` も可）がある場合、`orchport run` はデフォルトでpass-throughする。

例:

```txt
orchport run turbo dev
  -> package側 script: orchport run next dev
```

内側では、port再割り当てもproxy設定も行わず、単に `next dev` を実行する。

## 仕様

```txt
ORCHPORT=1（または orchport=1）のとき:

orchport run <command...>
  -> pass-through

orchport env/list/kill/init/doctor
  -> 通常実行
```

明示的に再解決したい場合だけ:

```bash
orchport run --nested <command...>
```

または:

```bash
orchport run --force-env <command...>
```

外側のorchportは以下を注入する。

```env
ORCHPORT=1
ORCHPORT_RUN_ID=01HX...
ORCHPORT_ROOT_PID=12345
```

---

# CLI設計

## 技術

```txt
Runtime: Bun
Language: TypeScript
CLI framework: Gunshi
Validation: Valibot
Lint: oxlint
Format: oxfmt
Bundle: Rolldown planned / optional
Binary: bun build --compile
```

## Modern CLI

interactiveにはしないが、見た目はmodernにする。

```txt
色付け
アイコン
整形テーブル
--json対応
--no-color対応
NO_COLOR対応
CI/non-TTY自動plain出力
```

候補ライブラリ:

```txt
picocolors
consola
```

ただし、依存を増やしすぎない。

---

# zsh autocomplete（未実装）

シェル補完は **後回し**（現行 CLI からは削除）。再導入時は Gunshi の completion 周りや静的 `_orchport` スクリプトを検討する。

---

# Tailscale/Funnel

## 状態

**planned only**。初期実装ではやらない。

## 将来設計

```bash
orchport run --tailscale turbo dev
orchport run --tailscale --funnel turbo dev
```

制約:

```txt
--tailscale が明示された場合のみ有効
--funnel は --tailscale 必須
funnelはpublic exposureなので --yes 必須にしてもよい
```

将来のenv:

```env
ORCHPORT_WEB_TAILSCALE_URL=https://machine.tailnet.ts.net:8443
ORCHPORT_PUBLIC_URL=https://machine.tailnet.ts.net:8443
```

初期実装では、オプションを予約してもよい。

```txt
--tailscale is planned but not implemented yet.
```

---

# proxy / 443

## MVP

proxyなしでよい。

```txt
http://localhost:<entry.port>
```

これが最もsandboxに強い。

## 将来

local proxy providerを追加可能。

```txt
http://web.feature-auth.acme.localhost:<proxy-port>
https://web.feature-auth.acme.localhost
```

ただし、443はsudoが必要な場合があるため、**必須機能にしない**。

```txt
443が使えない場合は自動fallback
sudo要求はしない
```

---

# Turborepoとの関係

orchportはTurborepoを知らなくてよい。

Turborepo側では、必要なら `ORCHPORT_*` をpass-throughする。

```json
{
  "$schema": "https://turborepo.com/schema.json",
  "globalPassThroughEnv": [
    "ORCHPORT_*",
    "NEXT_PUBLIC_API_URL",
    "BETTER_AUTH_URL",
    "OAUTH_CALLBACK_URL"
  ],
  "tasks": {
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

orchport側のconfigには `turbo` を書かない。

---

# package scripts例

root:

```json
{
  "scripts": {
    "dev": "orchport run turbo dev",
    "env": "orchport env",
    "list": "orchport list",
    "kill": "orchport kill --all"
  }
}
```

app:

```json
{
  "scripts": {
    "dev": "next dev --hostname 127.0.0.1 --port $ORCHPORT_WEB_PORT"
  }
}
```

Vite:

```json
{
  "scripts": {
    "dev": "vite --host 127.0.0.1 --port $ORCHPORT_WEB_PORT --strictPort"
  }
}
```

Bun API:

```ts
const port = Number(process.env.ORCHPORT_API_PORT ?? process.env.PORT ?? 3000);

Bun.serve({
  hostname: "127.0.0.1",
  port,
  fetch: app.fetch,
});
```

---

# ディレクトリ構成

```txt
orchport/
  src/
    index.ts
    commands/
      run.ts
      env.ts
      list.ts
      kill.ts
      init.ts
      doctor.ts
    config/
      define-config.ts
      entry.ts
      load.ts
      schema.ts
      resolve.ts
    env/
      build.ts
      interpolate.ts
      standard.ts
    ports/
      allocate.ts
      lock.ts
      registry.ts
    state/
      store.ts
      xdg.ts
      run-state.ts
    output/
      color.ts
      table.ts
      icons.ts
    utils/
      git.ts
      process.ts
      exec.ts
      errors.ts
  examples/
    basic/
    turbo/
    next-better-auth/
  package.json
  tsconfig.json
  oxlint.json
  rolldown.config.ts
```

---

# 実装ステータス（このリポジトリ）

次は **Phase 1〜3 のコア**が実装済み。Phase 4（Tailscale 等）は未着手。

| 領域                                     | 状態 | メモ                                                                                                                      |
| ---------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------- |
| Phase 1 `run` / `env` / `init`           | 済   | Gunshi。設定探索・YAML/JSON/TS・Valibot。`orchport run -- cmd` で `-` 付き argv を渡す。                                  |
| ネスト pass-through                      | 済   | `ORCHPORT=1` を標準とし、互換で `orchport=1` も受け入れる。                                                               |
| Phase 2 `list` / `kill` / `doctor`       | 済   | state は `ORCHPORT_STATE_DIR` または XDG。`doctor` は状態ディレクトリへプローブファイルで読み書き確認。zsh 補完は未実装。 |
| Phase 3 ビルトイン `*.localhost` / proxy | 済   | 既定 URL はコード内規則。TS のみ任意 `url` 関数。`local-proxy` + `run` でリバースプロキシ（Bun）。                        |
| 443 / sudo                               | 済   | `proxy.httpsPort` で追加 HTTP リスナを試行。`EACCES` / `EADDRINUSE` 等は warn のみで従来プロキシ継続（TLS なし）。        |
| sandbox state フォールバック             | 済   | state 書き込み失敗時は記録スキップ + `ORCHPORT_VOLATILE_STATE=1` を子に渡す。                                             |
| `bun build --compile`                    | 済   | `bun run build:compile` で単一バイナリ（`dist/orchport`）。既存 `build` はバンドルのみ。                                  |

---

# 実装フェーズ

## Phase 1 MVP

```txt
orchport run
orchport env
orchport init
config ts/yaml/json
Valibot validation
typed defineConfig / entry
stable port allocation
env generation
nested ORCHPORT=1 pass-through
bun build --compile
```

## Phase 2 操作性

```txt
orchport list
orchport kill
state管理
stale cleanup
modern output
doctor
(zsh completion は後回し)
```

## Phase 3 URL拡張

```txt
built-in *.localhost hostnames
optional TS url() override
optional local proxy
443 best-effort
sandbox fallback
```

## Phase 4 Planned

```txt
Tailscale Serve
Tailscale Funnel
public/tailnet URL env
exposure state
prune/reconcile
```

---

# まとめ

orchportはこの設計に絞るのがよいです。

```txt
orchport = non-interactive env + port + URL resolver for local multi-worktree web development
```

中心は:

```bash
orchport run turbo dev
```

configは:

```txt
entry定義
URL生成規則
env生成規則
```

だけを持つ。

TurborepoやBunやNodeの構造は知らない。
proxyやTailscaleはproviderとして後から足せる。
初期実装では、sudoなし・non-interactive・sandbox対応を最優先にして `localhost:<auto-port>` を確実に動かす。
