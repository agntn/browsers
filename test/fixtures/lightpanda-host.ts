/** Holds one local Lightpanda session. `--handle` adds a SIGTERM handler, like Playwright's. */
import { create } from "../../src/core/registry.ts";

if (process.argv.includes("--handle")) {
  process.on("SIGTERM", () => {
    process.stdout.write("handled\n");
    setTimeout(() => process.exit(0), 200);
  });
}

const provider = await create("lightpanda");
const session = await provider.createSession();
process.stdout.write(`${session.cdpUrl ?? ""}\n`);
setInterval(() => {}, 60_000);
