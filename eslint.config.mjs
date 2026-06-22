import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Build artifacts can also live in nested locations (e.g. git worktrees
    // under .claude/). ".next/**" only matches the repo-root one, so also
    // ignore any nested .next and the gitignored .claude tooling dir — eslint
    // flat config does not read .gitignore.
    "**/.next/**",
    ".claude/**",
  ]),
]);

export default eslintConfig;
