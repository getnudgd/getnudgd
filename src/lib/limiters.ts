import { createInMemoryRateLimiter } from "./ratelimit";

export const devLoginLimiter = createInMemoryRateLimiter(5, 60_000); // 5 attempts / minute
export const otpSendLimiter = createInMemoryRateLimiter(3, 5 * 60_000); // 3 sends / 5 minutes
export const otpVerifyLimiter = createInMemoryRateLimiter(5, 5 * 60_000); // 5 attempts / 5 minutes

export function limiterKey(userId: string | null, headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for");
  const ip = forwardedFor?.split(",")[0]?.trim() ?? "unknown"; // Caddy sets this in prod; "unknown" is a shared bucket for local dev/test
  return `${userId ?? "anon"}:${ip}`;
}
