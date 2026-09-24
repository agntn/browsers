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

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = new Uint8Array([0xff, 0xd8, 0xff]);
const RIFF_SIGNATURE = new TextEncoder().encode("RIFF");
const WEBP_SIGNATURE = new TextEncoder().encode("WEBP");

/**
 * Checks whether the bytes at `offset` spell the signature.
 *
 * @param {ArrayLike<number>} image Screenshot bytes.
 * @param {ArrayLike<number>} signature Bytes to look for.
 * @param {number} [offset] Position of the signature in the image.
 * @returns {boolean} Whether the signature is there.
 */
function hasSignature(image: ArrayLike<number>, signature: ArrayLike<number>, offset = 0): boolean {
  for (let index = 0; index < signature.length; index += 1) {
    if (image[offset + index] !== signature[index]) return false;
  }
  return true;
}

/**
 * Reads the image type from the bytes. Screenshot labels are not reliable:
 * Anchor declares `image/png` and sends JPEG for most of them.
 *
 * @param {ArrayLike<number>} image Screenshot bytes.
 * @param {string} declared Content type the response declared.
 * @returns {string} MIME type of the bytes.
 */
export function imageMimeType(image: ArrayLike<number>, declared: string): string {
  if (hasSignature(image, JPEG_SIGNATURE)) return "image/jpeg";
  if (hasSignature(image, PNG_SIGNATURE)) return "image/png";
  if (hasSignature(image, RIFF_SIGNATURE) && hasSignature(image, WEBP_SIGNATURE, 8)) {
    return "image/webp";
  }
  const declaredType = declared.split(";")[0]?.trim() ?? "";
  return declaredType.startsWith("image/") ? declaredType : "image/png";
}

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
 * Rejects an element screenshot on a provider whose API would capture the whole page instead.
 *
 * @param {string | undefined} selector Requested element selector.
 * @param {string} provider Provider name.
 * @returns {void}
 */
export function assertNoSelector(selector: string | undefined, provider: string): void {
  if (!selector) return;
  throw new UnsupportedOperationError(
    `${provider} cannot screenshot a single element. Use cloudflare, browserless or playwright, or drop selector.`,
    provider,
  );
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
  if (!capabilities.elementScreenshot) assertNoSelector(options.selector, provider.name());
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

/** How long a crawl or extract waits for its provider job by default. */
export const JOB_TIMEOUT = 120_000;

/** Pause between two reads of a running provider job. */
export const JOB_POLL_INTERVAL = 2_000;

/**
 * Reads a job until `done` accepts it or the timeout leaves no room for another read.
 *
 * @param {() => Promise<T>} read Reads the job once.
 * @param {(job: T) => boolean} done Whether the job has finished.
 * @param {number} timeout Milliseconds to wait in total.
 * @returns {Promise<T>} The last job read, finished or not.
 */
export async function waitForJob<T>(
  read: () => Promise<T>,
  done: (job: T) => boolean,
  timeout: number,
): Promise<T> {
  const deadline = Date.now() + timeout;
  let job = await read();
  while (!done(job) && Date.now() + JOB_POLL_INTERVAL <= deadline) {
    await new Promise((resolve) => setTimeout(resolve, JOB_POLL_INTERVAL));
    job = await read();
  }
  return job;
}
