/**
 * In-memory per-key attempt limit over a fixed window. Suitable for rare, user-initiated actions
 * on a single API process; it resets when the process restarts.
 */
export function createAttemptLimiter(options: {
  maxAttempts: number;
  windowMs: number;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const attempts = new Map<string, number[]>();
  return {
    /** Records an attempt and returns null, or returns the seconds to wait when over the limit. */
    attempt(key: string): number | null {
      const current = now();
      const recent = (attempts.get(key) ?? []).filter(
        (timestamp) => current - timestamp < options.windowMs,
      );
      if (recent.length >= options.maxAttempts) {
        attempts.set(key, recent);
        const oldest = recent[0] ?? current;
        return Math.max(1, Math.ceil((oldest + options.windowMs - current) / 1_000));
      }
      recent.push(current);
      attempts.set(key, recent);
      // Drop keys whose attempts have all expired so the map does not grow without bound.
      if (attempts.size > 10_000) {
        for (const [storedKey, timestamps] of attempts) {
          if (timestamps.every((timestamp) => current - timestamp >= options.windowMs))
            attempts.delete(storedKey);
        }
      }
      return null;
    },
  };
}
