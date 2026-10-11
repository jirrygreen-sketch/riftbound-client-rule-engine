import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const protocolEntry = new URL("../../packages/protocol/src/index.ts", import.meta.url)
  .pathname
  .replace(/^\/([A-Za-z]:\/)/, "$1");

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@riftbound/protocol": protocolEntry
    }
  },
  server: {
    strictPort: false
  }
});
