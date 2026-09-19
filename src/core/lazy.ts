/**
 * Memoize an async load so it runs once per process.
 *
 * The pending promise is shared, so concurrent first calls trigger one load. A rejection
 * clears it, which lets the next call retry instead of replaying the same failure forever.
 *
 * @param load - Producer of the value; runs on the first call and again after a rejection.
 * @returns {() => Promise<T>} Getter answering every call from the same pending promise.
 */
export function lazy<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    pending ??= (async () => load())().catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
    return pending;
  };
}
