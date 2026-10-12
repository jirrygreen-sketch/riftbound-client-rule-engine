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
      "@riftbound/protocol/full-product": rootPath("../../packages/protocol/src/full-product-contract.ts"),
      "@riftbound/engine-core/experimental": rootPath("../../packages/engine-core/src/full-product/runtime.ts"),
      "@riftbound/replay-core/full-product": rootPath("../../packages/replay-core/src/full-product/index.ts"),
      "@riftbound/protocol": rootPath("../../packages/protocol/src/index.ts"),
      "@riftbound/engine-core": rootPath("../../packages/engine-core/src/index.ts")
    }
  }
});
