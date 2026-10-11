import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootPath = (relativePath: string) =>
  fileURLToPath(new URL(relativePath, import.meta.url));

export default defineConfig({
  root: rootPath("."),
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 10_000,
    hookTimeout: 10_000
  },
  resolve: {
    alias: {
      "@riftbound/protocol": rootPath("../../packages/protocol/src/index.ts"),
      "@riftbound/engine-core": rootPath("../../packages/engine-core/src/index.ts"),
      "@riftbound/game-server-src": rootPath("../../apps/game-server/src/server.ts")
    }
  }
});
