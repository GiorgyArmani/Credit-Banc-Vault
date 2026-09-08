import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    // Mirrors the "@/*" -> "src/*" path alias in tsconfig.json, which vitest
    // does not read on its own.
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
