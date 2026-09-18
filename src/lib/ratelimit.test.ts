import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createInMemoryRateLimiter } from "./ratelimit";

describe("createInMemoryRateLimiter", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("allows up to maxRequests within the window", () => {
    const limiter = createInMemoryRateLimiter(3, 60_000);
    expect(limiter.check("ip-1")).toBe(true);
    expect(limiter.check("ip-1")).toBe(true);
    expect(limiter.check("ip-1")).toBe(true);
    expect(limiter.check("ip-1")).toBe(false);
  });

  it("tracks keys independently", () => {
    const limiter = createInMemoryRateLimiter(1, 60_000);
    expect(limiter.check("ip-1")).toBe(true);
    expect(limiter.check("ip-2")).toBe(true);
    expect(limiter.check("ip-1")).toBe(false);
  });

  it("allows requests again once the window passes", () => {
    const limiter = createInMemoryRateLimiter(1, 60_000);
    expect(limiter.check("ip-1")).toBe(true);
    expect(limiter.check("ip-1")).toBe(false);
    vi.advanceTimersByTime(60_001);
    expect(limiter.check("ip-1")).toBe(true);
  });
});
