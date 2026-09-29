import { resolve } from "node:path";
import { addTemplate, defineNuxtModule } from "nuxt/kit";
import { create } from "../../src/core/registry.ts";
import { _hasKey, providerEnvHint } from "../../src/core/resolve.ts";
import { builtins } from "../../src/providers/index.ts";
import { browserCapabilities } from "../../src/tool-operations.ts";
import { version } from "../../src/version.ts";
import type { BrowsersRegistry, ProviderRecord } from "../shared/types/registry.ts";

/** Every variable a built-in provider reads its credentials from. */
const PROVIDER_ENV = [
  "STEEL_API_KEY",
  "BROWSERBASE_API_KEY",
  "KERNEL_API_KEY",
  "BROWSERLESS_API_KEY",
  "HYPERBROWSER_API_KEY",
  "ANCHOR_API_KEY",
  "CF_API_TOKEN",
  "CF_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
] as const;

/**
 * Runs `callback` with every provider variable set to `value` (or cleared for `undefined`), then
 * puts the build's own environment back, so a key on the build machine never shapes the site.
 *
 * @param value - What every provider variable holds during the call.
 * @param callback - Work that reads the environment.
 * @returns {Promise<T>} What the callback returns.
 */
async function withProviderEnv<T>(value: string | undefined, callback: () => T | Promise<T>): Promise<T> {
  const saved = PROVIDER_ENV.map((name) => [name, process.env[name]] as const);
  for (const name of PROVIDER_ENV) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return await callback();
  } finally {
    for (const [name, previous] of saved) {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    }
  }
}

/**
 * Ships the registry as `#browsers-registry`, one template Nuxt bundles. The template is plain
 * JavaScript: a production build keeps it under `node_modules/.cache`, where Nitro strips no types. The provider
 * modules import `node:child_process` (Playwright) and would each pull an HTTP client into the
 * page, so they run once here, in Node, when Nuxt starts. Nothing under `src/core`,
 * `src/providers` or `src/tool-operations.ts` imports an npm package at module scope, which is
 * what lets Workers Builds skip installing the repo root. No request leaves the build: the
 * placeholder keys only get `browsers_capabilities` past its credential check, and the flags it
 * reports don't depend on them.
 */
export default defineNuxtModule({
  meta: { name: "browsers-registry" },
  async setup(_options, nuxt) {
    const keyless = await withProviderEnv(undefined, () =>
      builtins.filter((entry) => _hasKey(entry.key)).map((entry) => entry.key),
    );
    const providers = await withProviderEnv("docs-build", () =>
      Promise.all(
        builtins.map(async (entry): Promise<ProviderRecord> => {
          const provider = await create(entry.key);
          const [text] = (await browserCapabilities({ provider: entry.key })).content;
          if (text?.type !== "text") throw new Error(`browsers_capabilities gave ${entry.key} no text`);
          return {
            key: entry.key,
            defaultURL: entry.defaultURL,
            env: keyless.includes(entry.key) ? "none" : providerEnvHint(entry.key),
            keyless: keyless.includes(entry.key),
            capabilities: provider.capabilities(),
            capabilitiesText: text.text,
          };
        }),
      ),
    );

    const registry: BrowsersRegistry = { version, providers };
    const template = addTemplate({
      filename: "browsers-registry.mjs",
      write: true,
      getContents: () => `export default ${JSON.stringify(registry)};\n`,
    });
    /** Types for the template, beside it, where TypeScript looks for an `.mjs` file's declaration. */
    addTemplate({
      filename: "browsers-registry.d.mts",
      write: true,
      getContents: () =>
        [
          `import type { BrowsersRegistry } from "${resolve(import.meta.dirname, "../shared/types/registry.ts")}";`,
          "declare const registry: BrowsersRegistry;",
          "export default registry;",
          "",
        ].join("\n"),
    });
    nuxt.options.alias["#browsers-registry"] = template.dst;
  },
});
