/** Vercel AI SDK tools over the same definitions MCP, Pi, OMP and the CLI read. */

import { toAiTools, type AiTools } from "@agntn/tools/ai";
import { browserTools } from "./tools.ts";

/** Every browser tool under its MCP name. Providers and executors wait for the first call. */
export const browsersAiTools: AiTools<typeof browserTools> = toAiTools(browserTools);
