import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vitest/config";

const rootPath = (relativePath: string) =>
  fileURLToPath(new URL(relativePath, import.meta.url));

const engineSource = rootPath("../../packages/engine-core/src");
const preferEngineTypeScriptSource: Plugin = {
  name: "engine-core-source-prefers-typescript",
  enforce: "pre",
  resolveId(source, importer) {
    if (!importer?.startsWith(engineSource) ||
        !source.startsWith(".") ||
        !source.endsWith(".js")) {
      return null;
    }
    const candidate = path.resolve(path.dirname(importer), `${source.slice(0, -3)}.ts`);
    return existsSync(candidate) ? candidate : null;
  }
};

export default defineConfig({
  plugins: [preferEngineTypeScriptSource],
  test: {
    environment: "node",
    // Real room/replay tests transform the same Core source and can contend
    // heavily when file workers run together. Keep the original per-test limits.
    fileParallelism: false,
    // RIFT-1153 follow-up: co-located src/**/__tests__ suites belong to the full run too.
    include: ["tests/**/*.test.ts", "src/**/__tests__/**/*.test.ts"],
    testTimeout: 10_000,
    hookTimeout: 10_000
  },
  resolve: {
    alias: {
      "@riftbound/card-dsl/duel": rootPath("../../packages/card-dsl/src/duel/index.ts"),
      "@riftbound/protocol/full-product": rootPath("../../packages/protocol/src/full-product-contract.ts"),
      "@riftbound/engine-core/experimental": rootPath("../../packages/engine-core/src/full-product/runtime.ts"),
      "@riftbound/engine-core/duel": rootPath("../../packages/engine-core/src/duel/index.ts"),
      "@riftbound/replay-core/full-product": rootPath("../../packages/replay-core/src/full-product/index.ts"),
      "@riftbound/protocol": rootPath("../../packages/protocol/src/index.ts"),
      "@riftbound/engine-core": rootPath("../../packages/engine-core/src/index.ts")
    }
  }
});
