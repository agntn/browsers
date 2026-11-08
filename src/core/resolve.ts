import { create, providers as listProviders } from "./registry.ts";
import {
  UnknownProviderError,
  NoProviderConfiguredError,
  AuthError,
  InvalidInputError,
  UnsupportedOperationError,
} from "./errors.ts";
import type {
  BrowserProvider,
  CrawlOptions,
  CrawlResult,
  ScrapeOptions,
  ScreenshotOptions,
} from "./types.ts";
import { hasCloudflareCredentials, resolveCloudflareCredentials } from "./cloudflare.ts";
import { resolveCloudflareBrowser } from "./utils.ts";

/** Cloudflare reads `@agntn/credentials`, so a cf login stands in for the token and the account. */
const CLOUDFLARE_TOKEN = "CLOUDFLARE_API_TOKEN";
const CLOUDFLARE_HINT = `cf auth login or ${CLOUDFLARE_TOKEN}`;

/**
 * Check whether a provider runs without any credentials.
 *
 * @param {string} provider Provider name.
 * @returns {boolean} True for the local browsers. Lightpanda goes to its cloud only with a token.
 * @internal
 */
export function _keyless(provider: string): boolean {
  return provider === "playwright" || provider === "lightpanda" || provider === "attach";
}

/**
 * Check whether a call that names no provider may land here. Never attach: it drives your logins.
 *
 * @param {string} provider Provider name.
 * @returns {boolean} False for attach.
 * @internal
 */
export function _autoSelectable(provider: string): boolean {
  return provider !== "attach";
}

/**
 * Check whether a provider can run here. Cloudflare also counts a cf CLI login, which takes
 * running `cf auth whoami` when no token is exported.
 *
 * @param {string} provider Provider name.
 * @returns {Promise<boolean>} Whether credentials are available or unnecessary.
 * @internal
 */
export async function _hasKey(provider: string): Promise<boolean> {
  if (_keyless(provider)) return true;
  if (provider === "cloudflare") return hasCloudflareCredentials();
  return Boolean(process.env[`${provider.toUpperCase()}_API_KEY`]);
}

/**
 * Resolve a provider or reject a missing explicit choice. A named Cloudflare fails with the
 * credentials lookup's own reason: missing token or account, and how to log in.
 *
 * @param {string} [preferred] Preferred provider name.
 * @returns {Promise<string>} Resolved provider name.
 */
export async function resolveProvider(preferred?: string): Promise<string> {
  const available = listProviders();
  if (preferred) {
    if (!available.includes(preferred)) {
      throw new UnknownProviderError(preferred);
    }
    if (preferred === "cloudflare") await resolveCloudflareCredentials({});
    else if (!(await _hasKey(preferred))) {
      throw new AuthError(
        `Missing API key for ${preferred}. Set ${providerEnvKey(preferred)}`,
        preferred,
      );
    }
    return preferred;
  }
  for (const name of available) {
    if (_autoSelectable(name) && (await _hasKey(name))) return name;
  }
  throw new NoProviderConfiguredError();
}

/** Optional operations a provider may leave unimplemented. */
export type ProviderOperation =
  | "crawl"
  | "resumeCrawl"
  | "pdf"
  | "search"
  | "extract"
  | "links"
  | "accessibilityTree";

/** A provider known to implement `O`. */
export type ProviderWith<O extends ProviderOperation> = BrowserProvider &
  Required<Pick<BrowserProvider, O>>;

const operationLabels: Readonly<Record<ProviderOperation, string>> = {
  crawl: "crawl",
  resumeCrawl: "crawl jobs",
  pdf: "PDF generation",
  search: "web search",
  extract: "structured extraction",
  links: "link extraction",
  accessibilityTree: "accessibility trees",
};

function supports<O extends ProviderOperation>(
  provider: Readonly<BrowserProvider>,
  operation: O,
): provider is ProviderWith<O> {
  return typeof provider[operation] === "function";
}

/**
 * Build the first configured provider, in registry order, that `accepts`.
 *
 * @param {(provider: BrowserProvider) => provider is P} accepts Test the provider has to pass.
 * @param {string} label What the provider has to support, for the error.
 * @returns {Promise<{ name: string; provider: P }>} Resolved name and provider.
 */
async function firstProvider<P extends BrowserProvider>(
  accepts: (provider: Readonly<BrowserProvider>) => provider is P,
  label: string,
): Promise<{ name: string; provider: P }> {
  const checked: string[] = [];
  for (const name of listProviders()) {
    if (!_autoSelectable(name) || !(await _hasKey(name))) continue;
    const provider = await create(name);
    if (accepts(provider)) return { name, provider };
    checked.push(name);
  }
  if (checked.length === 0) throw new NoProviderConfiguredError();
  throw new UnsupportedOperationError(
    `No configured provider supports ${label} (checked: ${checked.join(", ")}).`,
    "",
  );
}

/**
 * Resolve and build the provider for one call.
 *
 * A Cloudflare `browser` without a provider selects Cloudflare. With an `operation` and no
 * provider, the first configured provider that implements it wins; a named provider that lacks
 * it is rejected rather than replaced.
 *
 * @param {string} [preferred] Preferred provider name.
 * @param {string} [browser] Optional Cloudflare browser engine.
 * @returns {Promise<{ name: string; provider: BrowserProvider }>} Resolved name and provider.
 */
export async function createProvider(
  preferred?: string,
  browser?: string,
): Promise<{ name: string; provider: BrowserProvider }>;
export async function createProvider<O extends ProviderOperation>(
  preferred: string | undefined,
  browser: string | undefined,
  operation: O,
): Promise<{ name: string; provider: ProviderWith<O> }>;
export async function createProvider(
  preferred?: string,
  browser?: string,
  operation?: ProviderOperation,
): Promise<{ name: string; provider: BrowserProvider }> {
  if (operation && !preferred && !browser) {
    return firstProvider(
      (provider): provider is ProviderWith<typeof operation> => supports(provider, operation),
      operationLabels[operation],
    );
  }
  const name = await resolveProvider(browser && !preferred ? "cloudflare" : preferred);
  const provider = await create(name, { browser: resolveCloudflareBrowser(name, browser) });
  if (operation && !supports(provider, operation)) {
    throw new UnsupportedOperationError(
      `Provider ${name} does not support ${operationLabels[operation]}.`,
      name,
    );
  }
  return { name, provider };
}

/** Capability flags that pick the provider for a call that names none. */
export type ProviderCapability =
  | "scrape"
  | "screenshot"
  | "elementScreenshot"
  | "screenshotWaitFor"
  | "scrapeWaitFor"
  | "sessions";

const capabilityLabels: Readonly<Record<ProviderCapability, string>> = {
  scrape: "scrape",
  screenshot: "screenshots",
  elementScreenshot: "element screenshots",
  screenshotWaitFor: "screenshots that wait for a selector",
  scrapeWaitFor: "scrapes that wait for a selector",
  sessions: "sessions",
};

/**
 * The flags a scrape needs: `scrape`, plus `scrapeWaitFor` once the caller waits for a selector.
 *
 * @param {ScrapeOptions} options The scrape's `waitFor`.
 * @returns {readonly ProviderCapability[]} Flags for `createCapableProvider`.
 */
export function scrapeCapabilities(
  options: Readonly<Pick<ScrapeOptions, "waitFor">>,
): readonly ProviderCapability[] {
  return options.waitFor === undefined ? ["scrape"] : ["scrape", "scrapeWaitFor"];
}

/**
 * Without a provider or browser, pick the first configured one that sets every flag asked for.
 *
 * @param {string | undefined} preferred Preferred provider name.
 * @param {string | undefined} browser Optional Cloudflare browser engine.
 * @param {ProviderCapability | readonly ProviderCapability[]} capability Flags it must set.
 * @returns {Promise<{ name: string; provider: BrowserProvider }>} Resolved name and provider.
 */
export async function createCapableProvider(
  preferred: string | undefined,
  browser: string | undefined,
  capability: ProviderCapability | readonly ProviderCapability[],
): Promise<{ name: string; provider: BrowserProvider }> {
  if (preferred || browser) return createProvider(preferred, browser);
  const required = typeof capability === "string" ? [capability] : capability;
  return firstProvider(
    (provider): provider is BrowserProvider => {
      const capabilities = provider.capabilities();
      return required.every((flag) => capabilities[flag] === true);
    },
    required.map((flag) => capabilityLabels[flag]).join(" and "),
  );
}

/**
 * Resolve and build a screenshot provider that can take the `selector` and `waitFor` asked for.
 *
 * @param {string} [preferred] Preferred provider name.
 * @param {string} [browser] Optional Cloudflare browser engine.
 * @param {ScreenshotOptions} [options] Element to capture and selector to wait for.
 * @returns {Promise<{ name: string; provider: BrowserProvider }>} Resolved name and provider.
 */
export async function createScreenshotProvider(
  preferred?: string,
  browser?: string,
  options: Readonly<Pick<ScreenshotOptions, "selector" | "waitFor">> = {},
): Promise<{ name: string; provider: BrowserProvider }> {
  const required: ProviderCapability[] = [];
  if (options.selector !== undefined) required.push("elementScreenshot");
  if (options.waitFor !== undefined) required.push("screenshotWaitFor");
  return createCapableProvider(preferred, browser, required.length > 0 ? required : "screenshot");
}

/**
 * Get the environment key hint for a provider.
 *
 * @param {string} provider Provider name.
 * @returns {string} Primary environment key.
 */
export function providerEnvKey(provider: string): string {
  return provider === "cloudflare" ? CLOUDFLARE_TOKEN : `${provider.toUpperCase()}_API_KEY`;
}

/**
 * Describe the environment values required by a provider.
 *
 * @param {string} provider Provider name.
 * @returns {string} Readable environment requirement.
 */
export function providerEnvHint(provider: string): string {
  return provider === "cloudflare" ? CLOUDFLARE_HINT : providerEnvKey(provider);
}

/**
 * Resolve the provider for one crawl call: a new crawl from `url`, or the job `jobId` names.
 *
 * A job ID belongs to the provider whose crawl returned it, so reading one needs that provider
 * named; auto-detection could pick another provider that has never seen the job.
 *
 * @param {Readonly<{ url?: string; jobId?: string }>} target Starting URL or job ID, not both.
 * @param {string} [preferred] Preferred provider name, required with `jobId`.
 * @param {string} [browser] Optional Cloudflare browser engine.
 * @returns {Promise<{ name: string; read: (options?: CrawlOptions) => Promise<CrawlResult> }>} Resolved name and the call that crawls or reads the job.
 */
export async function createCrawl(
  target: Readonly<{ url?: string; jobId?: string }>,
  preferred?: string,
  browser?: string,
): Promise<{ name: string; read: (options?: CrawlOptions) => Promise<CrawlResult> }> {
  const { url, jobId } = target;
  if (jobId === undefined) {
    if (url === undefined) {
      throw new InvalidInputError("Pass a URL to start a crawl or a job ID to read one.");
    }
    const { name, provider } = await createProvider(preferred, browser, "crawl");
    return { name, read: (options) => provider.crawl(url, options) };
  }
  if (url !== undefined) {
    throw new InvalidInputError("Pass a URL to start a crawl or a job ID to read one, not both.");
  }
  if (jobId === "") throw new InvalidInputError("The job ID must not be empty.");
  if (!preferred) {
    throw new InvalidInputError("Pass the provider whose crawl returned the job ID.");
  }
  const { name, provider } = await createProvider(preferred, browser, "resumeCrawl");
  return {
    name,
    read: (options) =>
      provider.resumeCrawl(jobId, { timeout: options?.timeout, signal: options?.signal }),
  };
}
