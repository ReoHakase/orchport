import { defineConfig } from "../../../../src/lib.ts";

// worktree は省略可（git から取得）。local-proxy の既定で tls: dev。
// `true` / `{}` は range: auto, strategy: deterministic, strict: false と同じ。
export default defineConfig({
  tld: "test",
  sld: "myapp",
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
    TRUSTED_ORIGINS: "${web.url}",
    CORS_ORIGIN: "${web.url}",
    TURSO_DATABASE_URL: "${db.url}",
  },
});
