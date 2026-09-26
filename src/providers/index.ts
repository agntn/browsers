import type { ProviderEntry } from "../core/registry.ts";

/**
 * Every provider shipped with the package, in registry order.
 *
 * Only the name and the default endpoint live here. The provider module is imported on the
 * first `create()` for its name, so nothing runs when the package is imported and a bundler
 * splits each provider into its own chunk. A provider missing from this list is invisible to
 * `create()`.
 */
export const builtins: readonly ProviderEntry[] = [
  {
    key: "steel",
    defaultURL: "https://api.steel.dev",
    load: () => import("./steel.ts").then((m) => m.factory),
  },
  {
    key: "browserbase",
    defaultURL: "https://api.browserbase.com",
    load: () => import("./browserbase.ts").then((m) => m.factory),
  },
  {
    key: "kernel",
    defaultURL: "https://api.onkernel.com",
    load: () => import("./kernel.ts").then((m) => m.factory),
  },
  {
    key: "browserless",
    defaultURL: "https://chrome.browserless.io",
    load: () => import("./browserless.ts").then((m) => m.factory),
  },
  {
    key: "hyperbrowser",
    defaultURL: "https://api.hyperbrowser.ai",
    load: () => import("./hyperbrowser.ts").then((m) => m.factory),
  },
  {
    key: "anchor",
    defaultURL: "https://api.anchorbrowser.io",
    load: () => import("./anchor.ts").then((m) => m.factory),
  },
  {
    key: "cloudflare",
    defaultURL: "https://api.cloudflare.com",
    load: () => import("./cloudflare.ts").then((m) => m.factory),
  },
  {
    key: "playwright",
    defaultURL: "local",
    load: () => import("./playwright.ts").then((m) => m.factory),
  },
];
