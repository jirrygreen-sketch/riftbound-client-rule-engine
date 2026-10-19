import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootPath = (relativePath: string) =>
  fileURLToPath(new URL(relativePath, import.meta.url));

export default defineConfig({
  root: rootPath("."),
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/full-product/**/*.test.ts", "test/headless/**/*.test.ts"],
    // File-level imports and dynamic game-server imports contend on Windows when
    // several Vitest workers transform the same workspace sources simultaneously.
    fileParallelism: false,
    testTimeout: 10_000,
    hookTimeout: 10_000
  },
  resolve: {
    alias: [
      { find: /^@riftbound\/replay-core\/full-product$/, replacement: rootPath("../../packages/replay-core/src/full-product/index.ts") },
      { find: /^@riftbound\/protocol$/, replacement: rootPath("../../packages/protocol/src/index.ts") },
      { find: /^@riftbound\/protocol\/full-product$/, replacement: rootPath("../../packages/protocol/src/full-product-contract.ts") },
      { find: /^@riftbound\/engine-core\/experimental$/, replacement: rootPath("../../packages/engine-core/src/full-product/runtime.ts") },
      { find: /^@riftbound\/engine-core\/duel$/, replacement: rootPath("../../packages/engine-core/src/duel/index.ts") },
      { find: /^@riftbound\/engine-core$/, replacement: rootPath("../../packages/engine-core/src/index.ts") },
      { find: /^@riftbound\/card-dsl\/duel$/, replacement: rootPath("../../packages/card-dsl/src/duel/index.ts") },
      { find: /^@riftbound\/game-server-src$/, replacement: rootPath("../../apps/game-server/src/server.ts") }
    ]
  }
});
