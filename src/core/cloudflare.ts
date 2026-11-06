import type { CloudflareCredential } from "@agntn/credentials/cloudflare";
import { AuthError, HTTPError } from "./errors.ts";

/** Token and account for one Cloudflare request. */
export interface CloudflareCredentials {
  readonly accountId: string;
  readonly token: string;
  /** True for a cf CLI token, the only kind a fresh lookup can replace after a 401. */
  readonly renewable: boolean;
}

/** What the caller configured; each field beats its environment variable. */
export interface CloudflareConfig {
  readonly token?: string;
  readonly accountId?: string;
}

/**
 * Resolve the token and account for the next Cloudflare request.
 *
 * Explicit values win, `@agntn/credentials` fills the rest from `CLOUDFLARE_API_TOKEN`, the
 * account variables and the cf CLI's OAuth session. A cf token expires, so callers resolve per
 * request. With both values configured the lookup module never loads.
 *
 * @param {CloudflareConfig} config Explicit token and account.
 * @param {boolean} [refresh] Ask cf again although its cached token has not expired, after a 401.
 * @returns {Promise<CloudflareCredentials>} Credentials for the next request.
 * @throws {AuthError} When no token or no single account is available.
 */
export async function resolveCloudflareCredentials(
  config: Readonly<CloudflareConfig>,
  refresh = false,
): Promise<CloudflareCredentials> {
  const token = config.token || undefined;
  const accountId = config.accountId || undefined;
  if (token !== undefined && accountId !== undefined) {
    return { token, accountId, renewable: false };
  }
  const found = await lookup({
    refresh,
    ...(token === undefined ? {} : { token }),
    ...(accountId === undefined ? {} : { accountId }),
  });
  return { token: found.token, accountId: found.accountId, renewable: found.source === "cli" };
}

/**
 * Ask `@agntn/credentials` and turn its refusal into an `AuthError` naming Cloudflare.
 *
 * @param {object} options What the caller configured, and whether to skip the cf cache.
 * @param {boolean} options.refresh Skip the cached cf token.
 * @param {string} [options.token] Configured token.
 * @param {string} [options.accountId] Configured account.
 * @returns {Promise<CloudflareCredential>} The token, where it came from and the account.
 */
async function lookup(
  options: Readonly<{ refresh: boolean; token?: string; accountId?: string }>,
): Promise<CloudflareCredential> {
  const [{ CredentialsError }, { resolve }] = await Promise.all([
    import("@agntn/credentials"),
    import("@agntn/credentials/cloudflare"),
  ]);
  try {
    return await resolve(options);
  } catch (error) {
    if (error instanceof CredentialsError) throw new AuthError(error.message, "cloudflare");
    throw error;
  }
}

/**
 * Report whether a request would find Cloudflare credentials: an environment token with an
 * account, or a cf session, which costs a `cf auth whoami` when nothing is exported.
 *
 * @returns {Promise<boolean>} True when a token and a single account are both available.
 */
export async function hasCloudflareCredentials(): Promise<boolean> {
  try {
    await resolveCloudflareCredentials({});
    return true;
  } catch (error) {
    if (error instanceof AuthError) return false;
    throw error;
  }
}

/**
 * Tell a refused token from a refused permission: only a 401 can change on a retry.
 *
 * @param {unknown} error Failure of the first attempt.
 * @returns {boolean} True for a 401.
 */
export function isUnauthorized(error: unknown): boolean {
  return error instanceof HTTPError && error.statusCode === 401;
}
