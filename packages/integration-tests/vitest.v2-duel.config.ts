import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const packageRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: packageRoot,
  test: {
    environment: "node",
    include: ["test/v2-duel/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 300_000,
    hookTimeout: 300_000
  },
  resolve: {
    alias: [
      {
        find: /^@riftbound\/protocol$/,
        replacement: fileURLToPath(new URL("../protocol/src/index.ts", import.meta.url))
      },
      {
        find: /^@riftbound\/game-server-src$/,
        replacement: fileURLToPath(new URL("../../apps/game-server/src/server.ts", import.meta.url))
      },
      {
        find: /^@riftbound\/card-dsl$/,
        replacement: fileURLToPath(new URL("../card-dsl/src/index.ts", import.meta.url))
      }
    ]
  }
});
