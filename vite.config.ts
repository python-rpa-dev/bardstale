import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  // WSL2 drives drop inotify events, leaving vite serving stale transforms.
  server: { watch: { usePolling: true } },
});
