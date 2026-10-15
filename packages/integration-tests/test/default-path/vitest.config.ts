import { defineConfig } from "vitest/config";
import base from "../../vitest.config.js";

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["test/default-path/**/*.test.ts"],
    testTimeout: 120_000
  }
});
