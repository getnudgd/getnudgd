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

  it("gets an insider profile by id, and returns null when not found", async () => {
    const { db, seedCompany } = createFakeDatabase();
    const company = seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const user = await db.identity.findOrCreateUser("fb-gp1", "gp1@acme.com", "seeker");
    const profile = await db.identity.findOrCreateInsiderProfile(user.id, company.id, "gp1@acme.com");
    expect((await db.identity.getInsiderProfileById(profile.id))?.id).toBe(profile.id);
    expect(await db.identity.getInsiderProfileById("nope")).toBeNull();
  });

  it("sets a user's role", async () => {
    const { db } = createFakeDatabase();
    const user = await db.identity.findOrCreateUser("fb-role1", "role1@b.com", "seeker");
    const updated = await db.identity.setUserRole(user.id, "both");
    expect(updated.role).toBe("both");
    expect((await db.identity.getUserById(user.id))?.role).toBe("both");
  });

  it("throws when setting role for a nonexistent user", async () => {
    const { db } = createFakeDatabase();
    await expect(db.identity.setUserRole("nope", "both")).rejects.toThrow();
  });
});

describe("createFakeDatabase resumes", () => {
  it("registers an upload with status \"uploaded\"", async () => {
    const { db } = createFakeDatabase();
    const resume = await db.resumes.registerUpload("seeker-1", "resumes/seeker-1/resume.pdf", "resume.pdf");
    expect(resume.status).toBe("uploaded");
    expect(resume.seekerProfileId).toBe("seeker-1");
    expect(resume.objectKey).toBe("resumes/seeker-1/resume.pdf");
  });

  it("returns null for a resume id that doesn't exist", async () => {
    const { db } = createFakeDatabase();
    expect(await db.resumes.getResumeById("nope")).toBeNull();
  });

  it("gets a resume by id", async () => {
    const { db } = createFakeDatabase();
    const created = await db.resumes.registerUpload("seeker-1", "resumes/seeker-1/a.pdf", "a.pdf");
    expect((await db.resumes.getResumeById(created.id))?.id).toBe(created.id);
  });

  it("lists resumes for a seeker profile, excluding other seekers'", async () => {
    const { db } = createFakeDatabase();
    await db.resumes.registerUpload("seeker-1", "resumes/seeker-1/a.pdf", "a.pdf");
    await db.resumes.registerUpload("seeker-1", "resumes/seeker-1/b.pdf", "b.pdf");
    await db.resumes.registerUpload("seeker-2", "resumes/seeker-2/c.pdf", "c.pdf");
    const results = await db.resumes.listResumesBySeekerProfileId("seeker-1");
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.seekerProfileId === "seeker-1")).toBe(true);
  });
});

describe("createFakeDatabase insiders", () => {
  async function makeVerifiedInsider(db: ReturnType<typeof createFakeDatabase>["db"], seedCompany: ReturnType<typeof createFakeDatabase>["seedCompany"], fbUid: string, email: string, companyName: string) {
    const company = seedCompany({ name: companyName, tier: "tier1" }, [`${companyName.toLowerCase().replace(/\s+/g, "")}.com`]);
    const user = await db.identity.findOrCreateUser(fbUid, email, "seeker");
    const profile = await db.identity.findOrCreateInsiderProfile(user.id, company.id, email);
    await db.identity.markInsiderVerified(profile.id, new Date());
    return { company, profile };
  }

  it("excludes unverified insiders from search results", async () => {
    const { db, seedCompany } = createFakeDatabase();
    const company = seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const user = await db.identity.findOrCreateUser("fb-unv", "unv@acme.com", "seeker");
    await db.identity.findOrCreateInsiderProfile(user.id, company.id, "unv@acme.com");
    expect(await db.insiders.listInsiders({})).toHaveLength(0);
  });

  it("includes verified, available insiders in search results", async () => {
    const { db, seedCompany } = createFakeDatabase();
    await makeVerifiedInsider(db, seedCompany, "fb-v1", "v1@acme.com", "Acme");
    const results = await db.insiders.listInsiders({});
    expect(results).toHaveLength(1);
    expect(results[0].companyName).toBe("Acme");
  });

  it("filters search results by companyId", async () => {
    const { db, seedCompany } = createFakeDatabase();
    const { company: acme } = await makeVerifiedInsider(db, seedCompany, "fb-v2", "v2@acme.com", "Acme");
    await makeVerifiedInsider(db, seedCompany, "fb-v3", "v3@beta.com", "Beta");
    const results = await db.insiders.listInsiders({ companyId: acme.id });
    expect(results).toHaveLength(1);
    expect(results[0].companyName).toBe("Acme");
  });

  it("excludes unavailable insiders from search results", async () => {
    const { db, seedCompany } = createFakeDatabase();
    const { profile } = await makeVerifiedInsider(db, seedCompany, "fb-v4", "v4@acme.com", "Acme");
    await db.insiders.setAvailability(profile.id, false);
    expect(await db.insiders.listInsiders({})).toHaveLength(0);
  });

  it("getInsiderById returns an unverified insider too (unlike listInsiders)", async () => {
    const { db, seedCompany } = createFakeDatabase();
    const company = seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const user = await db.identity.findOrCreateUser("fb-gi1", "gi1@acme.com", "seeker");
    const profile = await db.identity.findOrCreateInsiderProfile(user.id, company.id, "gi1@acme.com");
    expect((await db.insiders.getInsiderById(profile.id))?.insiderProfileId).toBe(profile.id);
  });

  it("getInsiderById returns null when not found", async () => {
    const { db } = createFakeDatabase();
    expect(await db.insiders.getInsiderById("nope")).toBeNull();
  });
});
