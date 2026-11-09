import { execSync, spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";

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

/* A browser the test started: its debugging address, its browser WebSocket and how to stop it. */
export interface Running {
  readonly endpoint: string;
  readonly socket: string;
  readonly stop: () => Promise<void>;
}

/* Starts a browser on port 0 and reads its port from stderr. A cold Firefox on CI took 30s. */
export async function launch(command: string, args: readonly string[]): Promise<Running> {
  const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
  const lines = createInterface({ input: child.stderr });
  const seen: string[] = [];
  const socket = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(
        new Error(`${command} printed no debugging address in 60s:\n${seen.slice(-20).join("\n")}`),
      );
    }, 60_000);
    lines.on("line", (line) => {
      seen.push(line);
      const address = /listening on (ws:\/\/\S+)/.exec(line)?.[1];
      if (!address) return;
      clearTimeout(timer);
      resolve(address);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`${command} exited with ${code}:\n${seen.slice(-20).join("\n")}`));
    });
  });
  return {
    endpoint: `http://${new URL(socket).host}`,
    socket,
    stop: async () => {
      child.kill();
      if (child.exitCode === null) await once(child, "exit");
    },
  };
}
