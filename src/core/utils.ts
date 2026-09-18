import type { HTTPError } from "./errors";
import { InvalidInputError, UnsupportedOperationError } from "./errors";
import type {
  BrowserProvider,
  CloudflareBrowser,
  CreateSessionOptions,
  ScrapeOptions,
  ScrapeResult,
  ScreenshotOptions,
  ScreenshotResult,
} from "./types";

/**
 * Check whether an error is an HTTP 404 from the provider API.
 *
 * @param {unknown} error Candidate error.
 * @returns {boolean} Whether the error reports HTTP 404.
 */
export function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && "statusCode" in error && (error as HTTPError).statusCode === 404;
}

/**
 * Assert that a session ID is present.
 *
 * @param {string | undefined} sessionId Session identifier.
 * @param {string} provider Provider name.
 * @param {string} operation Operation requiring a session.
 * @returns {void}
 */
export function assertSessionId(
  sessionId: string | undefined,
  provider: string,
  operation: string,
): asserts sessionId is string {
  if (!sessionId) {
    throw new InvalidInputError(
      `${provider} ${operation} requires a session. Create one first with createSession().`,
    );
  }
}

/**
 * Assert that either a URL or session is available.
 *
 * @param {string | undefined} url Target URL.
 * @param {{ readonly id: string } | undefined} session Browser session.
 * @param {string} provider Provider name.
 * @param {string} operation Operation requiring the target.
 * @returns {void}
 */
export function assertUrlOrSession(
  url: string | undefined,
  session: { readonly id: string } | undefined,
  provider: string,
  operation: string,
): void {
  if (!url && !session?.id) {
    throw new InvalidInputError(`${provider} ${operation} requires either a URL or a session`);
  }
}

/**
 * Scrape one URL, opening a temporary session when the provider cannot scrape statelessly.
 *
 * @param {BrowserProvider} provider Resolved provider.
 * @param {string} url Page to scrape.
 * @param {ScrapeOptions} [options] Scrape options.
 * @returns {Promise<ScrapeResult>} Scrape result.
 */
export async function scrapeWithSessionWhenNeeded(
  provider: Readonly<BrowserProvider>,
  url: string,
  options?: ScrapeOptions,
): Promise<ScrapeResult> {
  const capabilities = provider.capabilities();
  if (!capabilities.scrape || capabilities.statelessScrape) {
    return provider.scrape(url, options);
  }

  const session = await provider.createSession();
  try {
    return await provider.scrape(url, options, session);
  } finally {
    await provider.releaseSession(session.id).catch(() => undefined);
  }
}

/**
 * Screenshot one URL, opening a temporary session when the provider cannot screenshot statelessly.
 *
 * @param {BrowserProvider} provider Resolved provider.
 * @param {ScreenshotOptions} options Screenshot options, including the page URL.
 * @param {CreateSessionOptions} [sessionOptions] Options for the temporary session.
 * @returns {Promise<ScreenshotResult>} Screenshot result.
 */
export async function screenshotWithSessionWhenNeeded(
  provider: Readonly<BrowserProvider>,
  options: ScreenshotOptions,
  sessionOptions?: CreateSessionOptions,
): Promise<ScreenshotResult> {
  const capabilities = provider.capabilities();
  if (!capabilities.screenshot || capabilities.statelessScreenshot) {
    return provider.screenshot(options);
  }

  const session = await provider.createSession(sessionOptions);
  try {
    if (capabilities.navigate && options.url) {
      await provider.navigate(options.url, session).catch(() => undefined);
    }
    return await provider.screenshot(options, session);
  } finally {
    await provider.releaseSession(session.id).catch(() => undefined);
  }
}

/**
 * Keeps Kitesurf on Cloudflare and rejects bad values before a request.
 *
 * @param {string} provider Resolved provider name.
 * @param {string} browser Requested browser engine.
 * @returns {CloudflareBrowser | undefined} The validated Cloudflare browser engine.
 */
export function resolveCloudflareBrowser(
  provider: string,
  browser?: string,
): CloudflareBrowser | undefined {
  if (browser === undefined) return undefined;
  if (browser !== "kitesurf") {
    throw new InvalidInputError(`Unsupported Cloudflare browser: ${JSON.stringify(browser)}`);
  }
  if (provider !== "cloudflare") {
    throw new InvalidInputError("The Kitesurf browser is only available with Cloudflare");
  }
  return browser;
}

/**
 * Reject an operation that requires a direct browser connection.
 *
 * @param {string} provider Provider name.
 * @param {string} operation Unsupported operation.
 * @returns {never} This function always throws.
 */
export function notSupportedViaRest(provider: string, operation: string): never {
  throw new UnsupportedOperationError(
    `${provider} does not support ${operation} via REST. Connect via CDP for full automation.`,
    provider,
  );
}
