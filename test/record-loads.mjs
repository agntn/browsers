import { writeSync } from "node:fs";
import { registerHooks } from "node:module";

/**
 * Records every file module Node loads after this hook is registered and prints the list on
 * exit as one `@loaded [...]` line on stderr. `test/loads.test.ts` passes it through `--import`
 * to a child process and reads the line back; `writeSync` is used because citty ends the
 * usage paths with `process.exit`, and a piped stderr flushed asynchronously would be cut.
 */
const loaded = [];

registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith("file:")) loaded.push(url);
    return nextLoad(url, context);
  },
});

process.on("exit", () => {
  writeSync(2, `\n@loaded ${JSON.stringify(loaded)}\n`);
});
