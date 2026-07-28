import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Mirror the tsconfig path alias (`@/*` → `./*`) so unit tests import modules
// exactly as the app does. Node environment: the pilot's unit-tested code
// (lib/plan, lib/drawings, lib/boq) is pure TypeScript with no DOM.
const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": root,
    },
  },
  test: {
    environment: "node",
    include: [
      "lib/**/*.{test,spec}.ts",
      "lib/**/__tests__/**/*.{test,spec}.ts",
    ],
  },
});
