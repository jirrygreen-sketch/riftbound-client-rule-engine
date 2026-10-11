import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootPath = (relativePath: string) =>
  fileURLToPath(new URL(relativePath, import.meta.url));

export default defineConfig({
  root: rootPath("."),
  server: {
    hmr: false
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    testTimeout: 10_000,
    hookTimeout: 10_000
  },
  resolve: {
    alias: {
      "@riftbound/protocol": rootPath("../../packages/protocol/src/index.ts")
    }
  }
});
