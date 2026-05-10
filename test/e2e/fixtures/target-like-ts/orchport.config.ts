import { defineConfig } from "../../../../src/lib.ts";

// worktree は省略可（git から取得）。local-proxy の既定で tls: dev。
// `true` / `{}` は range: auto, strategy: deterministic, strict: false と同じ。
export default defineConfig({
  tld: "test",
  sld: "myapp",
  mode: "local-proxy",
  proxies: {
    web: {
      range: [3000, 3999],
      strategy: "smaller",
      strict: true,
      env: {
        // PORT: "${web.port}", // automatically assigned
        API_URL: "${api.url}",
      },
    },
    api: {
      range: [8000, 8999],
      strategy: "larger",
      switchables: ["/auth/callback/*"],
      env: {
        // PORT: "${api.port}", // automatically assigned
        DB_URL: "${db.url}",
        EMAIL_URL: "${email.url}",
      },
    },
    db: { range: [6000, 6999], strategy: "deterministic" },
    email: { range: [10_000, 10_999] },
    storybook: {
      env: {
        // PORT: "${storybook.port}", // automatically assigned
      },
    },
  },
  env: {
    TRUSTED_ORIGINS: "${web.url},${api.url}",
    APP_BASE_URL: "${web.url}",
    NEXT_PUBLIC_API_BASE_URL: "${api.url}",
    API_PUBLIC_URL: "${api.url}",
    BETTER_AUTH_URL: "${api.url}",
    TURSO_DATABASE_URL: "${db.url}",
  },
});
