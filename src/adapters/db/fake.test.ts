import { describe, it, expect } from "vitest";
import { createFakeDatabase } from "./fake";
import { LedgerImbalanceError } from "./types";

describe("createFakeDatabase ledger", () => {
  it("posts a balanced transaction and reflects it in balances", async () => {
    const { db } = createFakeDatabase();
    await db.ledger.postTxn({
      idempotencyKey: "t1",
      eventType: "test",
      entries: [
        { ownerType: "platform", ownerId: "platform", currency: "credits", amount: -5 },
        { ownerType: "seeker", ownerId: "s1", currency: "credits", amount: 5 },
      ],
    });
    expect(await db.ledger.getBalance("seeker", "s1", "credits")).toBe(5);
  });

  it("rejects an imbalanced transaction", async () => {
    const { db } = createFakeDatabase();
    await expect(
      db.ledger.postTxn({
        idempotencyKey: "t2",
        eventType: "test",
        entries: [{ ownerType: "seeker", ownerId: "s1", currency: "credits", amount: 5 }],
      })
    ).rejects.toThrow(LedgerImbalanceError);
  });

  it("is idempotent on repeated idempotency key", async () => {
    const { db } = createFakeDatabase();
    const input = {
      idempotencyKey: "t3",
      eventType: "test",
      entries: [
        { ownerType: "platform" as const, ownerId: "platform", currency: "credits" as const, amount: -1 },
        { ownerType: "seeker" as const, ownerId: "s1", currency: "credits" as const, amount: 1 },
      ],
    };
    const first = await db.ledger.postTxn(input);
    const second = await db.ledger.postTxn(input);
    expect(second.id).toBe(first.id);
    expect(await db.ledger.getBalance("seeker", "s1", "credits")).toBe(1);
  });

  it("returns null for an account that was never posted to", async () => {
    const { db } = createFakeDatabase();
    expect(await db.ledger.findAccount("insider", "unknown", "points")).toBeNull();
  });
});

describe("createFakeDatabase config", () => {
  it("returns null when a key has no rows", async () => {
    const { db } = createFakeDatabase();
    expect(await db.config.getLatest("rules")).toBeNull();
  });

  it("seedConfig makes a row visible via getLatest and getVersion", async () => {
    const { db, seedConfig } = createFakeDatabase();
    seedConfig({ key: "rules", version: 1, value: { a: 1 }, placeholder: true });
    seedConfig({ key: "rules", version: 2, value: { a: 2 }, placeholder: true });
    expect((await db.config.getLatest("rules"))?.version).toBe(2);
    expect((await db.config.getVersion("rules", 1))?.value).toEqual({ a: 1 });
  });
});

describe("createFakeDatabase identity", () => {
  it("finds or creates a user by firebase uid, idempotently", async () => {
    const { db } = createFakeDatabase();
    const first = await db.identity.findOrCreateUser("fb-1", "a@b.com", "seeker");
    const second = await db.identity.findOrCreateUser("fb-1", "a@b.com", "seeker");
    expect(second.id).toBe(first.id);
  });

  it("returns null for a user id that doesn't exist", async () => {
    const { db } = createFakeDatabase();
    expect(await db.identity.getUserById("nope")).toBeNull();
  });

  it("creates a seeker profile linked to a user", async () => {
    const { db } = createFakeDatabase();
    const user = await db.identity.findOrCreateUser("fb-2", "s@b.com", "seeker");
    const profile = await db.identity.createSeekerProfile(user.id, "Priya Sharma");
    expect(profile.userId).toBe(user.id);
    expect(profile.fullName).toBe("Priya Sharma");
  });

  it("finds a company by a seeded domain, and returns null for an unknown domain", async () => {
    const { db, seedCompany } = createFakeDatabase();
    const company = seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    expect((await db.identity.findCompanyByDomain("acme.com"))?.id).toBe(company.id);
    expect(await db.identity.findCompanyByDomain("unknown.com")).toBeNull();
  });

  it("creates an insider profile unverified by default", async () => {
    const { db, seedCompany } = createFakeDatabase();
    const company = seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const user = await db.identity.findOrCreateUser("fb-3", "i@acme.com", "insider");
    const profile = await db.identity.findOrCreateInsiderProfile(user.id, company.id, "i@acme.com");
    expect(profile.verifiedAt).toBeNull();
    expect(profile.available).toBe(true);
  });

  it("marks an insider profile verified", async () => {
    const { db, seedCompany } = createFakeDatabase();
    const company = seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const user = await db.identity.findOrCreateUser("fb-4", "i2@acme.com", "insider");
    const profile = await db.identity.findOrCreateInsiderProfile(user.id, company.id, "i2@acme.com");
    const when = new Date();
    await db.identity.markInsiderVerified(profile.id, when);
    expect(profile.verifiedAt).toEqual(when);
  });

  it("consumes a work-email OTP exactly once, rejects reuse", async () => {
    const { db, seedCompany } = createFakeDatabase();
    const company = seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const user = await db.identity.findOrCreateUser("fb-5", "i3@acme.com", "insider");
    const profile = await db.identity.findOrCreateInsiderProfile(user.id, company.id, "i3@acme.com");
    await db.identity.storeWorkEmailOtp(profile.id, "hash-1", new Date(Date.now() + 60_000));
    expect(await db.identity.consumeWorkEmailOtp(profile.id, "hash-1", new Date())).toBe(true);
    expect(await db.identity.consumeWorkEmailOtp(profile.id, "hash-1", new Date())).toBe(false);
  });

  it("rejects an expired work-email OTP", async () => {
    const { db, seedCompany } = createFakeDatabase();
    const company = seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const user = await db.identity.findOrCreateUser("fb-6", "i4@acme.com", "insider");
    const profile = await db.identity.findOrCreateInsiderProfile(user.id, company.id, "i4@acme.com");
    await db.identity.storeWorkEmailOtp(profile.id, "hash-2", new Date(Date.now() - 1000));
    expect(await db.identity.consumeWorkEmailOtp(profile.id, "hash-2", new Date())).toBe(false);
  });

  it("rejects a wrong code hash", async () => {
    const { db, seedCompany } = createFakeDatabase();
    const company = seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const user = await db.identity.findOrCreateUser("fb-7", "i5@acme.com", "insider");
    const profile = await db.identity.findOrCreateInsiderProfile(user.id, company.id, "i5@acme.com");
    await db.identity.storeWorkEmailOtp(profile.id, "hash-correct", new Date(Date.now() + 60_000));
    expect(await db.identity.consumeWorkEmailOtp(profile.id, "hash-wrong", new Date())).toBe(false);
  });

  it("returns the existing profile when called again for the same user (idempotent)", async () => {
    const { db, seedCompany } = createFakeDatabase();
    const company = seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const user = await db.identity.findOrCreateUser("fb-idem", "idem@acme.com", "seeker");
    const first = await db.identity.findOrCreateInsiderProfile(user.id, company.id, "idem@acme.com");
    const second = await db.identity.findOrCreateInsiderProfile(user.id, company.id, "idem@acme.com");
    expect(second.id).toBe(first.id);
  });
});
