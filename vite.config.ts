import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  // WSL2 drives drop inotify events, leaving vite serving stale transforms.
  server: { watch: { usePolling: true } },
  test: { exclude: ["e2e/**", "**/node_modules/**", "**/dist/**"] },
});
