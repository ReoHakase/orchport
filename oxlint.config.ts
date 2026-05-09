import { defineConfig } from "oxlint";

export default defineConfig({
  plugins: ["import", "node", "promise", "typescript", "unicorn", "oxc"],
  categories: {
    correctness: "error",
    suspicious: "error",
    perf: "warn",
  },
  ignorePatterns: [
    "coverage/**",
    "**/coverage/**",
    "dist/**",
    "**/dist/**",
    "node_modules/**",
    "**/node_modules/**",
  ],
  env: {
    builtin: true,
    es2024: true,
  },
  rules: {
    eqeqeq: ["error", "always", { null: "ignore" }],
    "func-style": ["error", "expression"],
    "arrow-body-style": ["error", "as-needed"],
    "unicorn/prefer-node-protocol": "error",
    "typescript/consistent-type-assertions": [
      "error",
      {
        assertionStyle: "never",
        objectLiteralTypeAssertions: "never",
        arrayLiteralTypeAssertions: "never",
      },
    ],
    "typescript/consistent-type-definitions": ["error", "type"],
    "typescript/consistent-type-imports": [
      "error",
      { prefer: "type-imports", fixStyle: "inline-type-imports" },
    ],
    "typescript/no-non-null-assertion": "error",
    "typescript/no-unsafe-type-assertion": "error",
    "typescript/prefer-function-type": "error",
  },
});
