import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});
vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
}));

const cookieStore = new Map<string, string>();
let currentIp = "10.0.0.1";
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieStore.has(name) ? { value: cookieStore.get(name)! } : undefined),
    set: (name: string, value: string) => {
      cookieStore.set(name, value);
    },
    delete: (name: string) => {
      cookieStore.delete(name);
    },
  }),
  headers: async () => new Headers({ "x-forwarded-for": currentIp }),
}));

import { resetEnvCacheForTests } from "@/src/config/env";
import { resetAdaptersCacheForTests } from "@/src/lib/adapters";
import { devLoginAction } from "./actions";

const REQUIRED_ENV = {
  APP_URL: "http://localhost:3000",
  BRAND_NAME: "GetNudgd",
  BRAND_DOMAIN: "getnudgd.com",
  DATABASE_URL: "postgres://getnudgd:getnudgd@localhost:5432/getnudgd",
  SESSION_COOKIE_SECRET: "a-test-secret-that-is-at-least-32-characters-long",
};

describe("devLoginAction", () => {
  const originalEnv = { ...process.env };
  let ipCounter = 0;

  beforeEach(() => {
    resetEnvCacheForTests();
    resetAdaptersCacheForTests();
    process.env = { ...originalEnv, NODE_ENV: "development", DEV_LOGIN_ENABLED: "true", ...REQUIRED_ENV };
    cookieStore.clear();
    redirectMock.mockClear();
    ipCounter++;
    currentIp = `10.0.0.${ipCounter}`; // unique per test — devLoginLimiter is keyed by IP alone (pre-auth), so tests must not share a bucket
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetEnvCacheForTests();
    resetAdaptersCacheForTests();
  });

  it("returns a problem when DEV_LOGIN_ENABLED is false", async () => {
    process.env.DEV_LOGIN_ENABLED = "false";
    resetEnvCacheForTests();
    const result = await devLoginAction({ email: "a@b.com", code: "000000" });
    expect(result).toEqual({ ok: false, problem: expect.objectContaining({ type: "auth-invalid-token" }) });
  });

  it("rejects the wrong code", async () => {
    const result = await devLoginAction({ email: "a@b.com", code: "111111" });
    expect(result).toEqual({ ok: false, problem: expect.objectContaining({ type: "dev-login-wrong-code" }) });
  });

  it("rejects an invalid email", async () => {
    const result = await devLoginAction({ email: "not-an-email", code: "000000" });
    expect(result).toEqual({ ok: false, problem: expect.objectContaining({ type: "validation-failed" }) });
  });

  it("signs in on the fixed dev code, sets a session cookie, and redirects a brand-new user to /onboard", async () => {
    await expect(devLoginAction({ email: "new-user@x.com", code: "000000" })).rejects.toThrow("REDIRECT:/onboard");
    expect(cookieStore.has("gn_session")).toBe(true);
  });

  it("denies after 5 failed attempts from the same IP, even though every attempt used a wrong code", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await devLoginAction({ email: "rl@x.com", code: "111111" });
      expect(r).toEqual({ ok: false, problem: expect.objectContaining({ type: "dev-login-wrong-code" }) });
    }
    const sixth = await devLoginAction({ email: "rl@x.com", code: "111111" });
    expect(sixth).toEqual({ ok: false, problem: expect.objectContaining({ type: "rate-limited" }) });
  });
});
