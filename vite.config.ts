import { defineConfig } from "vitest/config";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };
// build stamp for the title screen; falls back to "source" when .git is absent (tarball deploys)
let gitHash = "source";
try {
  gitHash = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
} catch {
  /* not a git checkout */
}

export default defineConfig({
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __GIT_HASH__: JSON.stringify(gitHash),
  },
  // WSL2 drives drop inotify events, leaving vite serving stale transforms.
  server: { watch: { usePolling: true } },
  test: { exclude: ["e2e/**", "**/node_modules/**", "**/dist/**"] },
});
