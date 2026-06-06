import type { HTTPError } from './errors'
import { InvalidInputError, UnsupportedOperationError } from './errors'

/**
 * Check if an error is an HTTP 404 from the provider API.
 * Used in getSession() implementations to return null for missing sessions.
 */
export function isNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error
    && 'statusCode' in error
    && (error as HTTPError).statusCode === 404
  )
}

/**
 * Assert that a session ID is present. Throws InvalidInputError if not.
 */
export function assertSessionId(
  sessionId: string | undefined,
  provider: string,
  operation: string,
): asserts sessionId is string {
  if (!sessionId) {
    throw new InvalidInputError(
      `${provider} ${operation} requires a session. Create one first with createSession().`,
    )
  }
}

/**
 * Assert that either a URL or session is provided for stateless-capable operations.
 */
export function assertUrlOrSession(
  url: string | undefined,
  session: { id: string } | undefined,
  provider: string,
  operation: string,
): void {
  if (!url && !session?.id) {
    throw new InvalidInputError(
      `${provider} ${operation} requires either a URL or a session`,
    )
  }
}

/**
 * Create an UnsupportedOperationError for provider methods that are not
 * implemented via REST (navigate, evaluate on CDP-only providers).
 */
export function notSupportedViaRest(provider: string, operation: string): never {
  throw new UnsupportedOperationError(
    `${provider} does not support ${operation} via REST. Connect via CDP for full automation.`,
    provider,
  )
}
