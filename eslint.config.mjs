import js from "@eslint/js";
import tseslint from "typescript-eslint";

// lint 対象は src / tests の TypeScript に限定する。
// build.mjs や scripts/*.mjs（Node スクリプト）は files の対象外なので
// `eslint` 実行時に検査されない。
export default tseslint.config(
  {
    ignores: ["node_modules", "dist"],
  },
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
  },
);
