import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));
const packagePath = (path: string) =>
  fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  root,
  test: {
    environment: "node",
    include: ["*.test.ts"],
    fileParallelism: false,
    testTimeout: 10_000,
    hookTimeout: 10_000
  },
  resolve: {
    alias: [
      { find: /^@riftbound\/replay-core\/full-product$/, replacement: packagePath("../../../../packages/replay-core/src/full-product/index.ts") },
      { find: /^@riftbound\/protocol$/, replacement: packagePath("../../../../packages/protocol/src/index.ts") },
      { find: /^@riftbound\/protocol\/full-product$/, replacement: packagePath("../../../../packages/protocol/src/full-product-contract.ts") },
      { find: /^@riftbound\/engine-core\/experimental$/, replacement: packagePath("../../../../packages/engine-core/src/full-product/runtime.ts") },
      { find: /^@riftbound\/engine-core\/duel$/, replacement: packagePath("../../../../packages/engine-core/src/duel/index.ts") },
      { find: /^@riftbound\/engine-core$/, replacement: packagePath("../../../../packages/engine-core/src/index.ts") },
      { find: /^@riftbound\/card-dsl\/duel$/, replacement: packagePath("../../../../packages/card-dsl/src/duel/index.ts") },
      { find: /^@riftbound\/game-server-src$/, replacement: packagePath("../../../../apps/game-server/src/server.ts") }
    ]
  }
});
