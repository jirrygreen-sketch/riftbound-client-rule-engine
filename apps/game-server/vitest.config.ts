import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootPath = (relativePath: string) =>
  fileURLToPath(new URL(relativePath, import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 10_000,
    hookTimeout: 10_000
  },
  resolve: {
    alias: {
      "@riftbound/protocol": rootPath("../../packages/protocol/src/index.ts"),
      "@riftbound/engine-core": rootPath("../../packages/engine-core/src/index.ts")
    }
  }
});
