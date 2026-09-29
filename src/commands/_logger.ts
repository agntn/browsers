import { createConsola } from "consola";

/**
 * Status lines of the CLI commands. They go to stderr, so a command's stdout holds only its
 * result and `browsers scrape <url> > page.md` saves the page alone.
 */
export const consola = createConsola({ stdout: process.stderr });
