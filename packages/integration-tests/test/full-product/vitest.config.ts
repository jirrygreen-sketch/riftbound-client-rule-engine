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
    alias: {
      "@riftbound/replay-core/full-product": packagePath("../../../../packages/replay-core/src/full-product/index.ts"),
      "@riftbound/protocol": packagePath("../../../../packages/protocol/src/index.ts"),
      "@riftbound/engine-core": packagePath("../../../../packages/engine-core/src/index.ts"),
      "@riftbound/game-server-src": packagePath("../../../../apps/game-server/src/server.ts")
    }
  }
});
