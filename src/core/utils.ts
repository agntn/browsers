import type { HTTPError } from "./errors";
import { InvalidInputError, UnsupportedOperationError } from "./errors";

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
