import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getEnv, resetEnvCacheForTests } from "./env";

const REQUIRED_ENV = {
  APP_URL: "http://localhost:3000",
  BRAND_NAME: "GetNudgd",
  BRAND_DOMAIN: "getnudgd.com",
  DATABASE_URL: "postgres://getnudgd:getnudgd@localhost:5432/getnudgd",
  SESSION_COOKIE_SECRET: "a-test-secret-that-is-at-least-32-characters-long",
};

describe("getEnv", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetEnvCacheForTests();
    process.env = { ...originalEnv, NODE_ENV: "development", ...REQUIRED_ENV };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetEnvCacheForTests();
  });

  it("parses a minimal valid environment", () => {
    const env = getEnv();
    expect(env.APP_URL).toBe(REQUIRED_ENV.APP_URL);
    expect(env.NODE_ENV).toBe("development");
    expect(env.ADAPTERS).toBe("fake");
    expect(env.GIFTCARD_VENDOR).toBe("manual");
  });

  it("throws with the missing field name when a required var is absent", () => {
    delete process.env.DATABASE_URL;
    expect(() => getEnv()).toThrow(/DATABASE_URL/);
  });

  it("leaves optional vendor secrets undefined when not set", () => {
    const env = getEnv();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.RAZORPAY_KEY_ID).toBeUndefined();
  });

  it("caches the parsed result across calls until reset", () => {
    const first = getEnv();
    process.env.APP_URL = "http://changed.example";
    const second = getEnv();
    expect(second).toBe(first);
  });

  it("throws when SESSION_COOKIE_SECRET is missing", () => {
    delete process.env.SESSION_COOKIE_SECRET;
    expect(() => getEnv()).toThrow(/SESSION_COOKIE_SECRET/);
  });

  it("throws when SESSION_COOKIE_SECRET is too short", () => {
    process.env.SESSION_COOKIE_SECRET = "too-short";
    expect(() => getEnv()).toThrow(/SESSION_COOKIE_SECRET/);
  });
});
