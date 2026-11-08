import { execSync } from "node:child_process";

/**
 * A Chrome or Chromium installed on the machine, which CI runners and most desks have.
 *
 * @returns {string | undefined} Its path, or nothing so Playwright falls back to its own build.
 */
export function systemChromium(): string | undefined {
  for (const name of ["google-chrome-stable", "google-chrome", "chromium", "chromium-browser"]) {
    try {
      const path = execSync(`which ${name}`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "ignore"],
      }).trim();
      if (path) return path;
    } catch {
      /* not found */
    }
  }
  return undefined;
}
