/** What only the CLI has; anything an agent needs goes to `tools.ts`. */
import { defineTool, Type } from "@agntn/tools";
import { BrowserError } from "./core/errors.ts";
import { releaseProcessSessions } from "./core/process-sessions.ts";
import { browserProviderNames } from "./tool-contract.ts";
import { loadOperations } from "./tools.ts";

/** `browsers sessions`: the active sessions of one provider, which no agent tool can drive. */
export const sessionsCommand = defineTool({
  name: "browsers_sessions",
  title: "Browser Sessions",
  description: "List the active sessions of a browser provider, by ID.",
  effect: "read",
  idempotent: false,
  openWorld: true,
  input: Type.Object(
    {
      provider: Type.Optional(
        Type.String({
          description: `Provider name. One of: ${browserProviderNames.join(", ")}. Auto-detected from env.`,
        }),
      ),
      browser: Type.Optional(
        Type.Literal("kitesurf", {
          description: "Use Cloudflare's Kitesurf engine instead of the default Chromium browser.",
        }),
      ),
    },
    { additionalProperties: false },
  ),
  cli: { short: { provider: "p" } },
  execute: async (input) => (await loadOperations()).listBrowserSessions(input),
});

/** The `session` subcommands before `runCli`, which knows one word per command. */
const sessionWords: ReadonlyMap<string, string> = new Map([
  ["create", "session"],
  ["release", "release"],
  ["list", "sessions"],
]);

/**
 * Rewrites `session create|release|list` to the command that does it now.
 *
 * @param args - Every argument after the bin.
 * @returns {string[]} The line `runCli` reads.
 */
export function normalizeSessionWords(args: readonly string[]): string[] {
  const [command, word, ...rest] = args;
  const target = command === "session" && word !== undefined ? sessionWords.get(word) : undefined;
  return target === undefined ? [...args] : [target, ...rest];
}

/** Releases this process's sessions, which no later command can reach, and says so on stderr. */
export async function releaseCommandSessions(): Promise<void> {
  for (const { id, provider } of await releaseProcessSessions()) {
    process.stderr.write(
      `[provider=${provider}] Session ${id} released: it lived in this process.\n`,
    );
  }
}

/**
 * Library errors and failed system calls, like an existing `path`, print as one line.
 *
 * @param error - What a command threw.
 * @returns {boolean} Whether it prints as one line.
 */
export function isRefusal(error: unknown): boolean {
  return error instanceof BrowserError || (error instanceof Error && "syscall" in error);
}
