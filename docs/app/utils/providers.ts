import registry from "#browsers-registry";
import type { BrowserProviderName, ProviderCapabilities, ProviderRecord } from "#shared/types/registry";

/** A display name, a glyph and one line per provider. Everything else comes from the library. */
const PRESENTATION: Record<BrowserProviderName, { name: string; icon: string; blurb: string }> = {
  steel: {
    name: "Steel",
    icon: "i-lucide-anvil",
    blurb: "One POST to /v1/scrape for a page, a session for everything else",
  },
  browserbase: {
    name: "Browserbase",
    icon: "i-lucide-layers",
    blurb: "Markdown from /v1/fetch without a session, CDP once you open one",
  },
  kernel: {
    name: "Kernel",
    icon: "i-lucide-cpu",
    blurb: "Every read runs Playwright inside a browser it opens first",
  },
  browserless: {
    name: "Browserless",
    icon: "i-lucide-container",
    blurb: "HTML, screenshots and PDFs, each from its own REST route",
  },
  hyperbrowser: {
    name: "Hyperbrowser",
    icon: "i-lucide-zap",
    blurb: "One fetch route for pages and screenshots, jobs for crawl and extract, and search",
  },
  anchor: {
    name: "Anchor",
    icon: "i-lucide-anchor",
    blurb: "Sessions and CDP. A screenshot needs a session and there's no scrape",
  },
  cloudflare: {
    name: "Cloudflare",
    icon: "i-lucide-cloud",
    blurb: "Browser Run: a route per output, crawl jobs, links and the accessibility tree",
  },
  playwright: {
    name: "Playwright",
    icon: "i-lucide-drama",
    blurb: "Chromium on your own machine. No key, no account, no bill",
  },
};

export interface ProviderEntry extends ProviderRecord {
  key: BrowserProviderName;
  name: string;
  icon: string;
  blurb: string;
  /** Docs page. */
  to: string;
}

/** The built-in providers in registry order, with the flags their instances report. */
export const PROVIDERS: readonly ProviderEntry[] = registry.providers.map((record) => {
  const key = record.key as BrowserProviderName;
  return { ...record, key, ...PRESENTATION[key], to: `/providers/${key}` };
});

/** The package version the registry was read from. */
export const VERSION = registry.version;

/**
 * One provider by its registry key.
 *
 * @param {string} key - A key as `create()` takes it.
 * @returns {ProviderEntry | undefined} Undefined for a key the site doesn't ship.
 */
export function providerEntry(key: string): ProviderEntry | undefined {
  return PROVIDERS.find((provider) => provider.key === key);
}

/**
 * A provider's place in the registry, 1-based, the way an ID bar numbers it.
 *
 * @param {string} key - A registry key.
 * @returns {number} Its position in the manifest.
 */
export function registryPosition(key: string): number {
  return PROVIDERS.findIndex((provider) => provider.key === key) + 1;
}

/** How a provider meets one operation. */
export type Support = "direct" | "session" | "no";

/** One column of the capability matrix: an operation and how to read its flags. */
export interface Operation {
  key: string;
  label: string;
  /** What the operation does, for the tooltip. */
  about: string;
  support: (capabilities: ProviderCapabilities) => Support;
}

function flag(name: keyof ProviderCapabilities): (capabilities: ProviderCapabilities) => Support {
  return (capabilities) => (capabilities[name] === true ? "direct" : "no");
}

function stateful(
  name: "scrape" | "screenshot",
  stateless: "statelessScrape" | "statelessScreenshot",
): (capabilities: ProviderCapabilities) => Support {
  return (capabilities) => {
    if (!capabilities[name]) return "no";
    return capabilities[stateless] ? "direct" : "session";
  };
}

/** The operations `capabilities()` reports, in the order the matrix and the dossier show them. */
export const OPERATIONS: readonly Operation[] = [
  { key: "scrape", label: "scrape", about: "Rendered page as markdown, text or HTML", support: stateful("scrape", "statelessScrape") },
  { key: "screenshot", label: "screenshot", about: "Image of the page", support: stateful("screenshot", "statelessScreenshot") },
  { key: "element", label: "element", about: "Image of the one element a selector names", support: flag("elementScreenshot") },
  { key: "pdf", label: "pdf", about: "The page printed to a PDF", support: flag("pdf") },
  { key: "crawl", label: "crawl", about: "Follow links from a start page", support: flag("crawl") },
  { key: "links", label: "links", about: "Unique hrefs in page order", support: flag("links") },
  { key: "accessibility", label: "a11y tree", about: "Roles, names and states, one node per line", support: flag("accessibilityTree") },
  { key: "extract", label: "extract", about: "Structured data from a prompt", support: flag("extract") },
  { key: "search", label: "search", about: "Web search", support: flag("search") },
  { key: "sessions", label: "sessions", about: "Create, list and release a browser", support: flag("sessions") },
  { key: "cdp", label: "cdp", about: "A DevTools URL for your own Playwright or Puppeteer", support: flag("cdp") },
  { key: "navigate", label: "navigate", about: "Drive a session to a URL (library only)", support: flag("navigate") },
  { key: "evaluate", label: "evaluate", about: "Run a script in a session (library only)", support: flag("evaluate") },
];

/**
 * The operations one provider can do, counting a session-only one.
 *
 * @param {ProviderEntry} provider - A provider.
 * @returns {number} How many of `OPERATIONS` it supports.
 */
export function supportedCount(provider: ProviderEntry): number {
  return OPERATIONS.filter((operation) => operation.support(provider.capabilities) !== "no").length;
}
