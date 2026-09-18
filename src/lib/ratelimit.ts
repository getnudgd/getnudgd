export interface RateLimiter {
  check(key: string): boolean;
}

export function createInMemoryRateLimiter(maxRequests = 5, windowMs = 60_000): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    check(key: string): boolean {
      const now = Date.now();
      const windowStart = now - windowMs;
      const recent = (hits.get(key) ?? []).filter((t) => t > windowStart);
      if (recent.length >= maxRequests) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      return true;
    },
  };
}
