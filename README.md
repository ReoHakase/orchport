<div align="center">

# 🎻 Orchport 🔌

  <img src=".github/opengraph.png" alt="Orchport" width="100%" />

ローカルのサブエージェントや git worktree 向けの非対話型 CLI です。複数の dev サーバーのポート衝突を避け、`web.<worktree>.myapp.localhost` のようなホスト規則で URL を組み立て、結果を `ORCHPORT_*` として子プロセスへ渡します。

</div>

## なぜ orchport か

> [!NOTE]
> [Vercel Labs / portless](https://github.com/vercel-labs/portless) のように、ローカル用の名前付き URL やプロキシを TTY 前提で起動するツールは、ヘッドレスなエージェントやワンショット実行では扱いづらいことがあります（例: [非対話環境でのプロンプト](https://github.com/vercel-labs/portless/issues/224)）。
>
> orchport はプロンプトを出さず、`orchport run -- cmd` で決定的に終わることを前提にしています。

## 主なコマンド

| コマンド          | 役割                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| `orchport run`    | 設定を読み、ポートと URL を解決。`local-proxy` ならリバースプロキシを立ててから子コマンドを実行 |
| `orchport env`    | 解決結果のみ表示（JSON / テーブル / shell 向けなど）                                            |
| `orchport list`   | 記録された run の一覧                                                                           |
| `orchport kill`   | 記録に基づきプロセスへシグナル                                                                  |
| `orchport doctor` | 状態ディレクトリと設定読み込みの簡易チェック                                                    |
| `orchport init`   | 設定ファイルの雛形生成                                                                          |
| `orchport switch` | `switchable` パスの向き先 worktree を更新（後述）                                               |

パススイッチ: OAuth コールバックなど、ホストは共通のまま特定パスだけ別 worktree のバックエンドへ振り分けられます。

## 使い方（概要）

```bash
orchport doctor
orchport env --json
orchport run -- turbo dev
```

`run` で子に渡る例: `ORCHPORT_WEB_PORT` などエントリ単位の変数、`ORCHPORT_SLD` / `ORCHPORT_TLD` / `ORCHPORT_WORKTREE` など。

設定ファイルはカレントから親へ向かって探索します。例: `orchport.config.ts`, `orchport.yaml`, `orchport.json`。

### グローバルオプション（サブコマンドより前）

| オプション          | 意味                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------- |
| `--config <path>`   | 設定ファイルを明示                                                                       |
| `--sld <name>`      | ホスト名のラベル（例: `*.myapp.localhost` の `myapp`）を上書き                           |
| `--tld <suffix>`    | 公開サフィックスを上書き。`localhost` や `.test` など。先頭の `.` は有無どちらでも正規化 |
| `--worktree <name>` | worktree 名を上書き                                                                      |
| `--force-switch`    | `orchport run` のみ。パススイッチのスロットが他 worktree のものでも奪って続行            |

> [!TIP]
> 子コマンドが `-` で始まる引数を取る場合は `orchport run -- cmd ...` のように `--` で区切ってください。

## ポート選択アルゴリズム

| 項目                     | 内容                                                                                                                                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| レンジの元               | エントリの `range` が `"auto"`（省略含む）→ ルートの `portRange`。ルート省略時は `[43100, 43999]`                                                                                                  |
| 明示レンジ               | `[min, max]` はその閉区間のみ。`min === max` は固定ポートとして扱う                                                                                                                                |
| 戦略 `strategy`          | `smaller`: min から昇順 / `larger`: max から降順 / `deterministic`（既定）: `hashStable(sld + "\0" + worktree + "\0" + entryName)` で開始位置を決め、レンジ内を一周する順で試す（FNV-1a 風 32bit） |
| 空き判定                 | 決めた順で、同一解決内ですでに使ったポートを除き、`127.0.0.1` で短時間 TCP リッスンできる最初の番号                                                                                                |
| 固定ポートが埋まっている | `strict: true` → エラー。`strict: false`（既定）→ 警告のうえグローバル `portRange` へフォールバック                                                                                                |
| 区間内に空きなし         | 同上。`strict: false` ならグローバル `portRange` へ、`true` ならエラー                                                                                                                             |

## パススイッチ（`switchable`）

> [!IMPORTANT]
> [Better Auth](https://www.better-auth.com/) などで OAuth コールバックを扱う場合、リダイレクト先 URL はアプリ側で 1 本に決める必要があります。一方で Google や GitHub などの OAuth プロバイダーは、開発用クライアントに **登録できるコールバック URL が 1 つ** に限られることが多く、worktree ごとに別ホスト・別 URL を登録し直すのは現実的ではありません。
>
> そのため「公開 URL とコールバックパスは常に同じにしつつ、プロキシだけ別 worktree の API に切り替える」パススイッチが必要になります。

`local-proxy` でプロキシを立てているとき、エントリに `switchable` を付けると、マッチしたパスだけ別 worktree の同じエントリ名の dev サーバーへ転送できます。

| トピック                 | 説明                                                                                                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| パターン                 | 完全一致 `/path` または末尾 `/prefix/*` のみ。`**` や途中の `*` は不可                                                                                                 |
| 状態                     | `ORCHPORT_STATE_DIR` または XDG 下の `switches.json` にスロット所有者を記録                                                                                            |
| `orchport run`           | `switchable` があると現在の worktree がスロットを claim。他が持っていればエラー。`--force-switch` で上書き                                                             |
| `orchport switch <slug>` | 設定内の全 `switchable` スロットの向き先を指定 worktree に更新。プロキシ再起動は不要。ポートはその worktree＋エントリの最新 run 状態から。無ければ該当リクエストは 502 |
| 振る舞い                 | 通常は Host でバックエンドを決め、パスが `switchable` に一致すると別ポートへ上書き転送                                                                                 |

## 設定ファイル（ルート）

| キー        | 型のイメージ                  | 既定・補足                                                                                              |
| ----------- | ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| `sld`       | 文字列                        | 省略時: git トップのディレクトリ名 → なければカレント名からスラッグ。ホスト `*.<sld><tld>`              |
| `tld`       | 文字列                        | 省略時: `.localhost`。読み込み時に先頭 `.` を正規化                                                     |
| `worktree`  | 文字列                        | 省略時: git から検出                                                                                    |
| `mode`      | `local-port` \| `local-proxy` | 既定: `local-port`。`local-proxy` で内蔵リバプロとプロキシ経由 URL                                      |
| `portRange` | `[number, number]`            | 既定: `[43100, 43999]`。`range: "auto"` と strict フォールバックで使用                                  |
| `proxy`     | オブジェクト                  | `local-proxy` で `tls` 省略 → 開発用自己署名 `dev`。`tls: false` で HTTP のみ。`httpsPort` で追加リスナ |
| `entries`   | 名前 → エントリ               | 必須。`web` なら `ORCHPORT_WEB_*`                                                                       |
| `env`       | マップまたは TS では関数      | `${web.url}` などの補間                                                                                 |

### エントリの形

| 書き方             | 意味                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| `true` または `{}` | `range: "auto"`, `strategy: "deterministic"`, `strict: false` と同等                                   |
| オブジェクト       | `range`（`"auto"` または `[min, max]`）, `strategy`, `strict`, 任意で `switchable`（文字列または配列） |

> [!NOTE]
> YAML / JSON ではレガシーキー `workspace` が `sld` と同義でマージされます。両方あり値が矛盾するとエラーです。

### `orchport.config.ts` の例

依存に `orchport` がある場合:

```typescript
import { defineConfig } from "orchport";

export default defineConfig({
  sld: "myapp",
  tld: "test",
  mode: "local-proxy",
  entries: {
    web: { range: [3000, 3999], strategy: "smaller", strict: true },
    api: {
      range: [8000, 8999],
      strategy: "larger",
      switchable: "/auth/callback/*",
    },
    db: { range: [6000, 6999], strategy: "deterministic" },
    email: { range: [10_000, 10_999] },
    storybook: true,
  },
  env: {
    APP_BASE_URL: "${web.url}",
    NEXT_PUBLIC_API_BASE_URL: "${api.url}",
    API_PUBLIC_URL: "${api.url}",
    BETTER_AUTH_URL: "${api.url}",
    TURSO_DATABASE_URL: "${db.url}",
  },
});
```
