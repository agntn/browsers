/** Sessions whose browser lives in this process: the CLI has to close them before it can exit. */

/** One such session and what closes it. */
interface ProcessSession {
  readonly provider: string;
  readonly release: () => Promise<void>;
}

/** Keyed by session ID, across provider instances, the way the providers keep their own stores. */
const processSessions = new Map<string, ProcessSession>();

/**
 * Records a session that ends with this process.
 *
 * @param id - Session ID.
 * @param session - Its provider and the call that releases it.
 */
export function holdProcessSession(id: string, session: ProcessSession): void {
  processSessions.set(id, session);
}

/**
 * Forgets a session once it is released.
 *
 * @param id - Session ID.
 */
export function dropProcessSession(id: string): void {
  processSessions.delete(id);
}

/** A session `releaseProcessSessions` closed. */
export interface ReleasedProcessSession {
  readonly id: string;
  readonly provider: string;
}

/**
 * Releases every session still held, so nothing this process started outlives it.
 *
 * @returns {Promise<ReleasedProcessSession[]>} What it released.
 */
export async function releaseProcessSessions(): Promise<ReleasedProcessSession[]> {
  const held = [...processSessions];
  processSessions.clear();
  await Promise.all(held.map(async ([, { release }]) => release()));
  return held.map(([id, { provider }]) => ({ id, provider }));
}
