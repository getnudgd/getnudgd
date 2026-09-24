import { describe, it, expect } from "vitest";
import { createFakeDatabase } from "./fake";
import { LedgerImbalanceError, InsufficientBalanceError, RequestStateConflictError } from "./types";

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

  it("updates an insider profile's company and work email", async () => {
    const { db, seedCompany } = createFakeDatabase();
    const acme = seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const beta = seedCompany({ name: "Beta", tier: "tier2" }, ["beta.com"]);
    const user = await db.identity.findOrCreateUser("fb-upd-1", "upd1@acme.com", "seeker");
    const profile = await db.identity.findOrCreateInsiderProfile(user.id, acme.id, "upd1@acme.com");
    const updated = await db.identity.updateInsiderProfileCompany(profile.id, beta.id, "upd1@beta.com");
    expect(updated.companyId).toBe(beta.id);
    expect(updated.workEmail).toBe("upd1@beta.com");
  });

  it("throws when updating a nonexistent insider profile's company", async () => {
    const { db, seedCompany } = createFakeDatabase();
    const beta = seedCompany({ name: "Beta", tier: "tier2" }, ["beta.com"]);
    await expect(db.identity.updateInsiderProfileCompany("nope", beta.id, "x@beta.com")).rejects.toThrow();
  });

  it("gets a seeker profile by id, and returns null when not found", async () => {
    const { db } = createFakeDatabase();
    const user = await db.identity.findOrCreateUser("fb-gsp1", "gsp1@x.com", "seeker");
    const profile = await db.identity.createSeekerProfile(user.id, "Get Seeker Profile");
    expect((await db.identity.getSeekerProfileById(profile.id))?.fullName).toBe("Get Seeker Profile");
    expect(await db.identity.getSeekerProfileById("nope")).toBeNull();
  });

  it("sets a user's phone, defaulting to null for a newly created user", async () => {
    const { db } = createFakeDatabase();
    const user = await db.identity.findOrCreateUser("fb-phone1", "phone1@x.com", "seeker");
    expect(user.phone).toBeNull();
    await db.identity.setUserPhone(user.id, "+911234567890");
    expect((await db.identity.getUserById(user.id))?.phone).toBe("+911234567890");
  });

  it("throws when setting phone for a nonexistent user", async () => {
    const { db } = createFakeDatabase();
    await expect(db.identity.setUserPhone("nope", "+911234567890")).rejects.toThrow();
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

describe("createFakeDatabase requests", () => {
  async function seedSeekerWithCredits(db: ReturnType<typeof createFakeDatabase>["db"], amount: number): Promise<string> {
    const user = await db.identity.findOrCreateUser(`fb-req-${amount}-${Math.random()}`, `req${amount}@seeker.com`, "seeker");
    const profile = await db.identity.createSeekerProfile(user.id, "Test Seeker");
    if (amount > 0) {
      await db.ledger.postTxn({
        idempotencyKey: `grant:${profile.id}:${amount}`,
        eventType: "credits.grant",
        entries: [
          { ownerType: "platform", ownerId: "platform", currency: "credits", amount: -amount },
          { ownerType: "seeker", ownerId: profile.id, currency: "credits", amount },
        ],
      });
    }
    return profile.id;
  }

  it("creates a SENT request and moves credits from seeker to escrow", async () => {
    const { db } = createFakeDatabase();
    const seekerProfileId = await seedSeekerWithCredits(db, 5);

    const request = await db.requests.sendRequest({
      idempotencyKey: "send:1",
      seekerProfileId,
      insiderProfileId: "insider-1",
      companyId: "company-1",
      creditCost: 3,
      rulesVersion: 1,
    });

    expect(request.state).toBe("SENT");
    expect(await db.ledger.getBalance("seeker", seekerProfileId, "credits")).toBe(2);
    expect(await db.ledger.getBalance("escrow", request.id, "credits")).toBe(3);
  });

  it("is idempotent: calling sendRequest twice with the same idempotencyKey returns the same request and does not double-charge", async () => {
    const { db } = createFakeDatabase();
    const seekerProfileId = await seedSeekerWithCredits(db, 5);

    const first = await db.requests.sendRequest({
      idempotencyKey: "send:2",
      seekerProfileId,
      insiderProfileId: "insider-1",
      companyId: "company-1",
      creditCost: 3,
      rulesVersion: 1,
    });
    const second = await db.requests.sendRequest({
      idempotencyKey: "send:2",
      seekerProfileId,
      insiderProfileId: "insider-1",
      companyId: "company-1",
      creditCost: 3,
      rulesVersion: 1,
    });

    expect(second.id).toBe(first.id);
    expect(await db.ledger.getBalance("seeker", seekerProfileId, "credits")).toBe(2);
  });

  it("throws InsufficientBalanceError when the seeker cannot cover the cost", async () => {
    const { db } = createFakeDatabase();
    const seekerProfileId = await seedSeekerWithCredits(db, 1);

    await expect(
      db.requests.sendRequest({
        idempotencyKey: "send:3",
        seekerProfileId,
        insiderProfileId: "insider-1",
        companyId: "company-1",
        creditCost: 3,
        rulesVersion: 1,
      })
    ).rejects.toThrow(InsufficientBalanceError);
  });

  it("getById returns null for an unknown request", async () => {
    const { db } = createFakeDatabase();
    expect(await db.requests.getById("nope")).toBeNull();
  });

  it("applyTransition moves a SENT request to ACCEPTED with no ledger movement", async () => {
    const { db } = createFakeDatabase();
    const seekerProfileId = await seedSeekerWithCredits(db, 5);
    const request = await db.requests.sendRequest({
      idempotencyKey: "send:4",
      seekerProfileId,
      insiderProfileId: "insider-1",
      companyId: "company-1",
      creditCost: 3,
      rulesVersion: 1,
    });

    const updated = await db.requests.applyTransition({
      idempotencyKey: `request:${request.id}:accept`,
      requestId: request.id,
      event: "accept",
      fromState: "SENT",
      toState: "ACCEPTED",
      ledgerEntries: [],
      ledgerEventType: "request.accept",
    });

    expect(updated.state).toBe("ACCEPTED");
    expect(await db.ledger.getBalance("escrow", request.id, "credits")).toBe(3);
  });

  it("applyTransition refunds escrow to the seeker on decline", async () => {
    const { db } = createFakeDatabase();
    const seekerProfileId = await seedSeekerWithCredits(db, 5);
    const request = await db.requests.sendRequest({
      idempotencyKey: "send:5",
      seekerProfileId,
      insiderProfileId: "insider-1",
      companyId: "company-1",
      creditCost: 3,
      rulesVersion: 1,
    });

    await db.requests.applyTransition({
      idempotencyKey: `request:${request.id}:decline`,
      requestId: request.id,
      event: "decline",
      fromState: "SENT",
      toState: "DECLINED",
      ledgerEntries: [
        { ownerType: "escrow", ownerId: request.id, currency: "credits", amount: -3 },
        { ownerType: "seeker", ownerId: seekerProfileId, currency: "credits", amount: 3 },
      ],
      ledgerEventType: "request.decline",
    });

    expect(await db.ledger.getBalance("escrow", request.id, "credits")).toBe(0);
    expect(await db.ledger.getBalance("seeker", seekerProfileId, "credits")).toBe(5);
  });

  it("applyTransition is idempotent: reapplying the same idempotencyKey does not re-refund", async () => {
    const { db } = createFakeDatabase();
    const seekerProfileId = await seedSeekerWithCredits(db, 5);
    const request = await db.requests.sendRequest({
      idempotencyKey: "send:6",
      seekerProfileId,
      insiderProfileId: "insider-1",
      companyId: "company-1",
      creditCost: 3,
      rulesVersion: 1,
    });
    const transitionInput = {
      idempotencyKey: `request:${request.id}:decline`,
      requestId: request.id,
      event: "decline",
      fromState: "SENT",
      toState: "DECLINED",
      ledgerEntries: [
        { ownerType: "escrow" as const, ownerId: request.id, currency: "credits" as const, amount: -3 },
        { ownerType: "seeker" as const, ownerId: seekerProfileId, currency: "credits" as const, amount: 3 },
      ],
      ledgerEventType: "request.decline",
    };

    await db.requests.applyTransition(transitionInput);
    await db.requests.applyTransition(transitionInput);

    expect(await db.ledger.getBalance("seeker", seekerProfileId, "credits")).toBe(5);
  });

  it("applyTransition throws RequestStateConflictError when fromState doesn't match the current state", async () => {
    const { db } = createFakeDatabase();
    const seekerProfileId = await seedSeekerWithCredits(db, 5);
    const request = await db.requests.sendRequest({
      idempotencyKey: "send:7",
      seekerProfileId,
      insiderProfileId: "insider-1",
      companyId: "company-1",
      creditCost: 3,
      rulesVersion: 1,
    });
    await db.requests.applyTransition({
      idempotencyKey: `request:${request.id}:accept`,
      requestId: request.id,
      event: "accept",
      fromState: "SENT",
      toState: "ACCEPTED",
      ledgerEntries: [],
      ledgerEventType: "request.accept",
    });

    await expect(
      db.requests.applyTransition({
        idempotencyKey: `request:${request.id}:decline`,
        requestId: request.id,
        event: "decline",
        fromState: "SENT",
        toState: "DECLINED",
        ledgerEntries: [],
        ledgerEventType: "request.decline",
      })
    ).rejects.toThrow(RequestStateConflictError);
  });
});

describe("createFakeDatabase requests proof and admin review", () => {
  async function makeAcceptedRequest(db: ReturnType<typeof createFakeDatabase>["db"]): Promise<{ requestId: string }> {
    const user = await db.identity.findOrCreateUser(`fb-proof-${Math.random()}`, `proof${Math.random()}@x.com`, "seeker");
    const seekerProfile = await db.identity.createSeekerProfile(user.id, "Proof Seeker");
    await db.ledger.postTxn({
      idempotencyKey: `grant:${seekerProfile.id}`,
      eventType: "credits.grant",
      entries: [
        { ownerType: "platform", ownerId: "platform", currency: "credits", amount: -5 },
        { ownerType: "seeker", ownerId: seekerProfile.id, currency: "credits", amount: 5 },
      ],
    });
    const request = await db.requests.sendRequest({
      idempotencyKey: `send:${seekerProfile.id}`,
      seekerProfileId: seekerProfile.id,
      insiderProfileId: "insider-x",
      companyId: "company-x",
      creditCost: 3,
      rulesVersion: 1,
    });
    await db.requests.applyTransition({
      idempotencyKey: `request:${request.id}:accept`,
      requestId: request.id,
      event: "accept",
      fromState: "SENT",
      toState: "ACCEPTED",
      ledgerEntries: [],
      ledgerEventType: "request.accept",
    });
    return { requestId: request.id };
  }

  it("submitProof moves ACCEPTED to PROOF_PENDING and records the proof", async () => {
    const { db } = createFakeDatabase();
    const { requestId } = await makeAcceptedRequest(db);

    const updated = await db.requests.submitProof({
      idempotencyKey: "proof:1",
      requestId,
      fromState: "ACCEPTED",
      toState: "PROOF_PENDING",
      proofType: "text",
      textContent: "Submitted via internal portal",
    });

    expect(updated.state).toBe("PROOF_PENDING");
    const proof = await db.requests.getProofByRequestId(requestId);
    expect(proof?.proofType).toBe("text");
    expect(proof?.textContent).toBe("Submitted via internal portal");
  });

  it("submitProof is idempotent: same key does not create a duplicate proof row", async () => {
    const { db } = createFakeDatabase();
    const { requestId } = await makeAcceptedRequest(db);
    const input = {
      idempotencyKey: "proof:2",
      requestId,
      fromState: "ACCEPTED",
      toState: "PROOF_PENDING",
      proofType: "text",
      textContent: "First submission",
    };
    await db.requests.submitProof(input);
    await db.requests.submitProof(input);

    const proofs = await db.requests.listProofsByRequestId(requestId);
    expect(proofs).toHaveLength(1);
    expect(proofs[0].textContent).toBe("First submission");
  });

  it("submitProof throws RequestStateConflictError when fromState doesn't match", async () => {
    const { db } = createFakeDatabase();
    const { requestId } = await makeAcceptedRequest(db);
    await expect(
      db.requests.submitProof({
        idempotencyKey: "proof:3",
        requestId,
        fromState: "PROOF_PENDING", // wrong — request is actually ACCEPTED
        toState: "SUBMITTED",
        proofType: "text",
        textContent: "x",
      })
    ).rejects.toThrow(RequestStateConflictError);
  });

  it("listByState returns only requests in the given state", async () => {
    const { db } = createFakeDatabase();
    const { requestId } = await makeAcceptedRequest(db);
    const accepted = await db.requests.listByState("ACCEPTED");
    expect(accepted.map((r) => r.id)).toContain(requestId);
    expect(await db.requests.listByState("PROOF_PENDING")).toHaveLength(0);
  });

  it("getProofByRequestId returns null when no proof exists", async () => {
    const { db } = createFakeDatabase();
    const { requestId } = await makeAcceptedRequest(db);
    expect(await db.requests.getProofByRequestId(requestId)).toBeNull();
  });

  it("getProofByRequestId returns the most recently submitted proof after a resubmission", async () => {
    const { db } = createFakeDatabase();
    const { requestId } = await makeAcceptedRequest(db);
    await db.requests.submitProof({
      idempotencyKey: "proof:latest:1",
      requestId,
      fromState: "ACCEPTED",
      toState: "PROOF_PENDING",
      proofType: "text",
      textContent: "first attempt",
    });
    await db.requests.applyTransition({
      idempotencyKey: "review:latest:reject",
      requestId,
      event: "reject",
      fromState: "PROOF_PENDING",
      toState: "ACCEPTED",
      ledgerEntries: [],
      ledgerEventType: "request.reject",
    });
    await db.requests.submitProof({
      idempotencyKey: "proof:latest:2",
      requestId,
      fromState: "ACCEPTED",
      toState: "PROOF_PENDING",
      proofType: "text",
      textContent: "second attempt",
    });

    const latest = await db.requests.getProofByRequestId(requestId);
    expect(latest?.textContent).toBe("second attempt");
    const all = await db.requests.listProofsByRequestId(requestId);
    expect(all).toHaveLength(2);
  });

  it("applyTransition writes an admin_audit_log row when adminAudit is provided", async () => {
    const { db } = createFakeDatabase();
    const { requestId } = await makeAcceptedRequest(db);
    await db.requests.submitProof({
      idempotencyKey: "proof:4",
      requestId,
      fromState: "ACCEPTED",
      toState: "PROOF_PENDING",
      proofType: "text",
      textContent: "x",
    });

    await db.requests.applyTransition({
      idempotencyKey: "review:1",
      requestId,
      event: "verify",
      fromState: "PROOF_PENDING",
      toState: "SUBMITTED",
      ledgerEntries: [],
      ledgerEventType: "request.verify",
      adminAudit: {
        adminUserId: "admin-1",
        action: "proof.verify",
        targetType: "insider_request",
        targetId: requestId,
      },
    });

    expect(await db.requests.listByState("SUBMITTED")).toHaveLength(1);
    const auditRows = await db.requests.listAuditLogByTarget("insider_request", requestId);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].action).toBe("proof.verify");
    expect(auditRows[0].adminUserId).toBe("admin-1");
  });

  it("applyTransition does not write an admin_audit_log row when adminAudit is omitted", async () => {
    const { db } = createFakeDatabase();
    const { requestId } = await makeAcceptedRequest(db);
    await db.requests.submitProof({
      idempotencyKey: "proof:5",
      requestId,
      fromState: "ACCEPTED",
      toState: "PROOF_PENDING",
      proofType: "screenshot",
      objectKey: "proofs/x.png",
    });
    const proof = await db.requests.getProofByRequestId(requestId);
    expect(proof?.objectKey).toBe("proofs/x.png");
    expect(proof?.textContent).toBeNull();

    await db.requests.applyTransition({
      idempotencyKey: "review:2",
      requestId,
      event: "verify",
      fromState: "PROOF_PENDING",
      toState: "SUBMITTED",
      ledgerEntries: [],
      ledgerEventType: "request.verify",
      // adminAudit deliberately omitted — accept/decline/expire from the prior
      // plan already call applyTransition this way; confirm it still holds here.
    });
    expect(await db.requests.listAuditLogByTarget("insider_request", requestId)).toHaveLength(0);
  });
});

describe("createFakeDatabase notifications", () => {
  it("creates a pending notification with no channel and no deliveredAt", async () => {
    const { db } = createFakeDatabase();
    const user = await db.identity.findOrCreateUser("fb-notif1", "notif1@x.com", "seeker");
    const { record } = await db.notifications.create({
      userId: user.id,
      template: "request.accepted",
      payload: { requestId: "r1", companyName: "Acme" },
      idempotencyKey: "test:k1",
    });
    expect(record.status).toBe("pending");
    expect(record.channel).toBeNull();
    expect(record.deliveredAt).toBeNull();
    expect(record.error).toBeNull();
  });

  it("getById returns null for an unknown id", async () => {
    const { db } = createFakeDatabase();
    expect(await db.notifications.getById("nope")).toBeNull();
  });

  it("markSent sets status, channel, and deliveredAt", async () => {
    const { db } = createFakeDatabase();
    const user = await db.identity.findOrCreateUser("fb-notif2", "notif2@x.com", "seeker");
    const { record } = await db.notifications.create({
      userId: user.id,
      template: "request.accepted",
      payload: {},
      idempotencyKey: "test:k2",
    });
    const when = new Date();
    await db.notifications.markSent(record.id, "email", when);
    const updated = await db.notifications.getById(record.id);
    expect(updated?.status).toBe("sent");
    expect(updated?.channel).toBe("email");
    expect(updated?.deliveredAt).toEqual(when);
  });

  it("markFailed sets status and error", async () => {
    const { db } = createFakeDatabase();
    const user = await db.identity.findOrCreateUser("fb-notif3", "notif3@x.com", "seeker");
    const { record } = await db.notifications.create({
      userId: user.id,
      template: "request.accepted",
      payload: {},
      idempotencyKey: "test:k3",
    });
    await db.notifications.markFailed(record.id, "all channels failed");
    const updated = await db.notifications.getById(record.id);
    expect(updated?.status).toBe("failed");
    expect(updated?.error).toBe("all channels failed");
  });

  it("create returns created=true and the record for a new idempotency key", async () => {
    const { db } = createFakeDatabase();
    const user = await db.identity.findOrCreateUser("fb-idem-1", "idem1@x.com", "seeker");
    const result = await db.notifications.create({
      userId: user.id,
      template: "request.accepted",
      payload: { a: 1 },
      idempotencyKey: "evt:1:request.accepted:u",
    });
    expect(result.created).toBe(true);
    expect(result.record.idempotencyKey).toBe("evt:1:request.accepted:u");
    expect(result.record.status).toBe("pending");
  });

  it("create with an existing idempotency key returns the original record with created=false and adds no row", async () => {
    const { db } = createFakeDatabase();
    const user = await db.identity.findOrCreateUser("fb-idem-2", "idem2@x.com", "seeker");
    const first = await db.notifications.create({
      userId: user.id,
      template: "request.accepted",
      payload: { a: 1 },
      idempotencyKey: "evt:2:request.accepted:u",
    });
    const second = await db.notifications.create({
      userId: user.id,
      template: "request.accepted",
      payload: { a: 2 },
      idempotencyKey: "evt:2:request.accepted:u",
    });
    expect(second.created).toBe(false);
    expect(second.record.id).toBe(first.record.id);
    expect(second.record.payload).toEqual({ a: 1 });
  });
});
