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
    // Heavy gate runs share this host with many parallel tasks. The 2026-10-19
    // rerun observed load1 > 280 on a 180-core host while WebSocket and matrix
    // flows were still transforming and executing; keep their existing assertions
    // with enough runner headroom rather than changing test semantics.
    testTimeout: 240_000,
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
