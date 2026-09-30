import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getSessionFromCookiesMock = vi.fn();
vi.mock("./session", () => ({
  getSessionFromCookies: () => getSessionFromCookiesMock(),
}));

import { getCurrentUser } from "./current-user";
import { getAdapters, resetAdaptersCacheForTests } from "./adapters";
import { resetEnvCacheForTests } from "../config/env";

const REQUIRED_ENV = {
  APP_URL: "http://localhost:3000",
  BRAND_NAME: "GetNudgd",
  BRAND_DOMAIN: "getnudgd.com",
  DATABASE_URL: "postgres://getnudgd:getnudgd@localhost:5432/getnudgd",
  SESSION_COOKIE_SECRET: "a-test-secret-that-is-at-least-32-characters-long",
};

describe("getCurrentUser", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetEnvCacheForTests();
    resetAdaptersCacheForTests();
    process.env = { ...originalEnv, NODE_ENV: "development", ...REQUIRED_ENV };
    getSessionFromCookiesMock.mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetEnvCacheForTests();
    resetAdaptersCacheForTests();
  });

  it("returns null when there is no session cookie", async () => {
    getSessionFromCookiesMock.mockResolvedValue(null);
    expect(await getCurrentUser()).toBeNull();
  });

  it("returns the current user derived from the session's userId", async () => {
    const { db } = getAdapters();
    const user = await db.identity.findOrCreateUser("fb-cu-session-1", "cusession1@x.com", "seeker");
    getSessionFromCookiesMock.mockResolvedValue({ userId: user.id, role: "seeker", issuedAt: Date.now() });

    expect(await getCurrentUser()).toEqual({
      userId: user.id,
      role: "seeker",
      seekerProfileId: null,
      insiderProfile: null,
    });
  });

  it("returns null when the session points to a user that no longer exists", async () => {
    getSessionFromCookiesMock.mockResolvedValue({ userId: "deleted-user", role: "seeker", issuedAt: Date.now() });
    expect(await getCurrentUser()).toBeNull();
  });
});
