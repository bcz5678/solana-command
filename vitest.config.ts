import { defineConfig } from "vitest/config";
import path from "node:path";

// Mirrors tsconfig.json's "paths" — vitest doesn't read that file itself,
// so without this, any test importing @site/schema or @site/renderer (or
// @/*) fails with "Cannot find package" before a single test runs.
export default defineConfig({
  resolve: {
    alias: {
      "@site/schema": path.resolve(__dirname, "site-platform/schema/index.ts"),
      "@site/renderer": path.resolve(__dirname, "site-platform/renderer/index.ts"),
      "@": path.resolve(__dirname, "."),
    },
  },
});
