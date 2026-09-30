import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resetEnvCacheForTests } from "../config/env";
import { getAdapters, resetAdaptersCacheForTests } from "./adapters";
import { InvalidTokenError } from "../adapters/auth/types";

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

  it("always uses fake storage and email regardless of ADAPTERS, since no real implementation exists yet", () => {
    process.env.ADAPTERS = "real";
    resetEnvCacheForTests();
    const adapters = getAdapters();
    expect(adapters.storage).toBeDefined();
    expect(adapters.email).toBeDefined();
  });

  it("uses the fake auth adapter outside production, regardless of ADAPTERS", async () => {
    process.env.ADAPTERS = "real";
    resetEnvCacheForTests();
    const adapters = getAdapters();
    const token = Buffer.from(JSON.stringify({ providerUid: "fb-1", email: "a@b.com" })).toString("base64url");
    await expect(adapters.auth.verifyIdToken(token)).resolves.toEqual({ providerUid: "fb-1", email: "a@b.com" });
  });

  it("uses the fake auth adapter when NODE_ENV=test, not the production-refusing one", async () => {
    process.env = { ...process.env, NODE_ENV: "test" };
    resetEnvCacheForTests();
    const adapters = getAdapters();
    const token = Buffer.from(JSON.stringify({ providerUid: "fb-1", email: "a@b.com" })).toString("base64url");
    await expect(adapters.auth.verifyIdToken(token)).resolves.toEqual({ providerUid: "fb-1", email: "a@b.com" });
  });

  it("rejects every token in production, including an otherwise-valid fake token", async () => {
    process.env = { ...process.env, NODE_ENV: "production" };
    resetEnvCacheForTests();
    const adapters = getAdapters();
    const token = Buffer.from(JSON.stringify({ providerUid: "fb-1", email: "a@b.com" })).toString("base64url");
    await expect(adapters.auth.verifyIdToken(token)).rejects.toThrow(InvalidTokenError);
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

  it("uses the file mailbox sender when DEV_MAILBOX_PATH is set outside production", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "gn-mailbox-adapters-"));
    const filePath = path.join(dir, "mailbox.jsonl");
    process.env.DEV_MAILBOX_PATH = filePath;
    resetEnvCacheForTests();
    const adapters = getAdapters();
    await adapters.email.send({ to: "a@b.com", subject: "Hi", html: "<p>hi</p>" });
    expect(readFileSync(filePath, "utf8")).toContain("a@b.com");
    rmSync(dir, { recursive: true, force: true });
  });

  it("uses the plain fake sender when DEV_MAILBOX_PATH is unset", async () => {
    const adapters = getAdapters();
    const result = await adapters.email.send({ to: "a@b.com", subject: "Hi", html: "<p>hi</p>" });
    expect(result.id).toMatch(/^fake-email-/);
  });
});
