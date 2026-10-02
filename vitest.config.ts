import { defineConfig } from "vitest/config";

// Minimal unit-test harness for pure modules only (no DOM, no Tauri, no window).
// App build config stays in vite.config.ts; tests must not need it.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});