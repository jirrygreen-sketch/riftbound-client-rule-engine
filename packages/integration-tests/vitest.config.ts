import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootPath = (relativePath: string) =>
  fileURLToPath(new URL(relativePath, import.meta.url));

export default defineConfig({
  root: rootPath("."),
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/full-product/**/*.test.ts"],
    // File-level imports and dynamic game-server imports contend on Windows when
    // several Vitest workers transform the same workspace sources simultaneously.
    fileParallelism: false,
    testTimeout: 10_000,
    hookTimeout: 10_000
  },
  resolve: {
    alias: {
      "@riftbound/replay-core/full-product": rootPath("../../packages/replay-core/src/full-product/index.ts"),
      "@riftbound/protocol": rootPath("../../packages/protocol/src/index.ts"),
      "@riftbound/engine-core": rootPath("../../packages/engine-core/src/index.ts"),
      "@riftbound/game-server-src": rootPath("../../apps/game-server/src/server.ts")
    }
  }
});
