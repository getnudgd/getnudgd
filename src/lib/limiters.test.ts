import { describe, it, expect } from "vitest";
import { devLoginLimiter, otpSendLimiter, otpVerifyLimiter, limiterKey } from "./limiters";

describe("rate limiters", () => {
  it("devLoginLimiter allows 5 attempts then denies the 6th", () => {
    const key = "dev-login-k1";
    for (let i = 0; i < 5; i++) expect(devLoginLimiter.check(key)).toBe(true);
    expect(devLoginLimiter.check(key)).toBe(false);
  });

  it("otpSendLimiter allows 3 attempts then denies the 4th", () => {
    const key = "otp-send-k1";
    for (let i = 0; i < 3; i++) expect(otpSendLimiter.check(key)).toBe(true);
    expect(otpSendLimiter.check(key)).toBe(false);
  });

  it("otpVerifyLimiter allows 5 attempts then denies the 6th", () => {
    const key = "otp-verify-k1";
    for (let i = 0; i < 5; i++) expect(otpVerifyLimiter.check(key)).toBe(true);
    expect(otpVerifyLimiter.check(key)).toBe(false);
  });
});

describe("limiterKey", () => {
  it("keys different users independently even behind the same IP", () => {
    const headers = new Headers({ "x-forwarded-for": "1.1.1.1" });
    expect(limiterKey("user-a", headers)).not.toBe(limiterKey("user-b", headers));
  });

  it("takes the first entry of a comma-separated x-forwarded-for chain", () => {
    const headers = new Headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" });
    expect(limiterKey("u1", headers)).toBe("u1:9.9.9.9");
  });

  it("falls back to \"unknown\" when x-forwarded-for is absent", () => {
    expect(limiterKey(null, new Headers())).toBe("anon:unknown");
  });
});
