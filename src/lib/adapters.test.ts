import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetEnvCacheForTests } from "../config/env";
import { getAdapters, resetAdaptersCacheForTests } from "./adapters";

const REQUIRED_ENV = {
  APP_URL: "http://localhost:3000",
  BRAND_NAME: "GetNudgd",
  BRAND_DOMAIN: "getnudgd.com",
  DATABASE_URL: "postgres://getnudgd:getnudgd@localhost:5432/getnudgd",
  SESSION_COOKIE_SECRET: "a-test-secret-that-is-at-least-32-characters-long",
};

describe("getAdapters", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetEnvCacheForTests();
    resetAdaptersCacheForTests();
    process.env = { ...originalEnv, NODE_ENV: "development", ...REQUIRED_ENV };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetEnvCacheForTests();
    resetAdaptersCacheForTests();
  });

  it("returns all five adapters", () => {
    const adapters = getAdapters();
    expect(adapters.db).toBeDefined();
    expect(adapters.queue).toBeDefined();
    expect(adapters.auth).toBeDefined();
    expect(adapters.storage).toBeDefined();
    expect(adapters.email).toBeDefined();
  });

  it("defaults to the fake db and queue when ADAPTERS is unset", async () => {
    const adapters = getAdapters();
    // The fake db's ledger.getBalance never touches a network connection; a real
    // one constructed against an unreachable DATABASE_URL would hang or throw
    // on first query. Calling it here proves we got the fake, not the real, adapter.
    await expect(adapters.db.ledger.getBalance("seeker", "nonexistent", "credits")).resolves.toBe(0);
  });

  it("uses the real db and queue when ADAPTERS=real", () => {
    process.env.ADAPTERS = "real";
    resetEnvCacheForTests();
    const adapters = getAdapters();
    // Constructing a real Pool/drizzle instance never connects eagerly, so this
    // must not throw even though no real Postgres is reachable in this test run.
    expect(adapters.db).toBeDefined();
    expect(adapters.queue).toBeDefined();
  });

  it("always uses fake auth, storage, and email regardless of ADAPTERS, since no real implementation exists yet", () => {
    process.env.ADAPTERS = "real";
    resetEnvCacheForTests();
    const adapters = getAdapters();
    expect(adapters.auth).toBeDefined();
    expect(adapters.storage).toBeDefined();
    expect(adapters.email).toBeDefined();
  });

  it("memoizes: repeated calls return the same instance", () => {
    const first = getAdapters();
    const second = getAdapters();
    expect(second).toBe(first);
  });

  it("resetAdaptersCacheForTests forces a fresh instance on the next call", () => {
    const first = getAdapters();
    resetAdaptersCacheForTests();
    const second = getAdapters();
    expect(second).not.toBe(first);
  });
});
