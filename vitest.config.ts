import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["packages/**/*.test.{ts,tsx}", "examples/**/*.test.{ts,tsx}"] },
  esbuild: { jsx: "automatic" },
});
