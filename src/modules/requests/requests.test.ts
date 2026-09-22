import { describe, it, expect } from "vitest";
import { createFakeDatabase } from "../../adapters/db/fake";
import { createFakeQueueClient } from "../../jobs/queue.fake";
import type { QueueClient } from "../../jobs/queue";
import { InvalidTransitionError } from "./state";
import { sendRequest, accept, decline, expire, submitProof, sweepExpiredSent, InsiderUnavailableError, MissingProofContentError, type RequestsDeps } from "./requests";

const RULES_VALUE = {
  responseWindowHours: 48,
  interviewWindowDays: 14,
  reverificationDays: 90,
  tranche1Percent: 50,
  tranche2Percent: 50,
  refundPercentOnDecline: 100,
  refundPercentOnExpiry: 60,
  minRedemptionPoints: 500,
  panThresholdPoints: 5000,
  freeCreditGrant: 3,
  requestCostByTier: { tier1: 3, tier2: 2, tier3: 1 },
};

async function makeVerifiedInsiderAndFundedSeeker(
  creditGrant = 5
): Promise<{ deps: RequestsDeps; seekerProfileId: string; insiderProfileId: string }> {
  const { db, seedConfig, seedCompany } = createFakeDatabase();
  seedConfig({ key: "rules", version: 1, placeholder: true, value: RULES_VALUE });
  const company = seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);

  const seekerUser = await db.identity.findOrCreateUser("fb-seeker-1", "seeker1@x.com", "seeker");
  const seekerProfile = await db.identity.createSeekerProfile(seekerUser.id, "Seeker One");
  if (creditGrant > 0) {
    await db.ledger.postTxn({
      idempotencyKey: `grant:${seekerProfile.id}`,
      eventType: "credits.grant",
      entries: [
        { ownerType: "platform", ownerId: "platform", currency: "credits", amount: -creditGrant },
        { ownerType: "seeker", ownerId: seekerProfile.id, currency: "credits", amount: creditGrant },
      ],
    });
  }

  const insiderUser = await db.identity.findOrCreateUser("fb-insider-1", "insider1@acme.com", "seeker");
  const insiderProfile = await db.identity.findOrCreateInsiderProfile(insiderUser.id, company.id, "insider1@acme.com");
  await db.identity.markInsiderVerified(insiderProfile.id, new Date());

  return { deps: { db, queue: createFakeQueueClient() }, seekerProfileId: seekerProfile.id, insiderProfileId: insiderProfile.id };
}

describe("sendRequest", () => {
  it("debits the seeker and escrows the insider's tier1 cost", async () => {
    const { deps, seekerProfileId, insiderProfileId } = await makeVerifiedInsiderAndFundedSeeker(5);
    const request = await sendRequest(deps, { idempotencyKey: "k1", seekerProfileId, insiderProfileId });
    expect(request.state).toBe("SENT");
    expect(request.creditCost).toBe(3);
    expect(await deps.db.ledger.getBalance("seeker", seekerProfileId, "credits")).toBe(2);
  });

  it("stamps the rules_version the request was created under", async () => {
    const { deps, seekerProfileId, insiderProfileId } = await makeVerifiedInsiderAndFundedSeeker(5);
    const request = await sendRequest(deps, { idempotencyKey: "k2", seekerProfileId, insiderProfileId });
    expect(request.rulesVersion).toBe(1);
  });

  it("throws InsiderUnavailableError for an unverified insider", async () => {
    const { db, seedConfig, seedCompany } = createFakeDatabase();
    seedConfig({ key: "rules", version: 1, placeholder: true, value: RULES_VALUE });
    const company = seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const seekerUser = await db.identity.findOrCreateUser("fb-s2", "s2@x.com", "seeker");
    const seekerProfile = await db.identity.createSeekerProfile(seekerUser.id, "S2");
    const insiderUser = await db.identity.findOrCreateUser("fb-i2", "i2@acme.com", "seeker");
    const insiderProfile = await db.identity.findOrCreateInsiderProfile(insiderUser.id, company.id, "i2@acme.com");
    // deliberately not verified

    await expect(
      sendRequest({ db, queue: createFakeQueueClient() }, { idempotencyKey: "k3", seekerProfileId: seekerProfile.id, insiderProfileId: insiderProfile.id })
    ).rejects.toThrow(InsiderUnavailableError);
  });

  it("throws InsiderUnavailableError for an unavailable insider", async () => {
    const { deps, seekerProfileId, insiderProfileId } = await makeVerifiedInsiderAndFundedSeeker(5);
    await deps.db.insiders.setAvailability(insiderProfileId, false);
    await expect(
      sendRequest(deps, { idempotencyKey: "k4", seekerProfileId, insiderProfileId })
    ).rejects.toThrow(InsiderUnavailableError);
  });

  it("propagates InsufficientBalanceError when the seeker cannot afford the request", async () => {
    const { deps, seekerProfileId, insiderProfileId } = await makeVerifiedInsiderAndFundedSeeker(1);
    await expect(
      sendRequest(deps, { idempotencyKey: "k5", seekerProfileId, insiderProfileId })
    ).rejects.toThrow();
  });

  it("enqueues a request.expire job with a singleton key and the configured response window", async () => {
    const sentJobs: Array<{ queueName: string; payload: unknown; options?: { singletonKey?: string; startAfterSeconds?: number } }> = [];
    const spyQueue: QueueClient = {
      async start() {},
      async stop() {},
      async send(queueName, payload, options) {
        sentJobs.push({ queueName, payload, options });
        return "job-1";
      },
      async work() {},
      async schedule() {},
    };
    const { db, seedConfig, seedCompany } = createFakeDatabase();
    seedConfig({ key: "rules", version: 1, placeholder: true, value: RULES_VALUE });
    const company = seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const seekerUser = await db.identity.findOrCreateUser("fb-eq-1", "eq1@x.com", "seeker");
    const seekerProfile = await db.identity.createSeekerProfile(seekerUser.id, "EQ Seeker");
    await db.ledger.postTxn({
      idempotencyKey: "grant:eq1",
      eventType: "credits.grant",
      entries: [
        { ownerType: "platform", ownerId: "platform", currency: "credits", amount: -5 },
        { ownerType: "seeker", ownerId: seekerProfile.id, currency: "credits", amount: 5 },
      ],
    });
    const insiderUser = await db.identity.findOrCreateUser("fb-eq-2", "eq2@acme.com", "seeker");
    const insiderProfile = await db.identity.findOrCreateInsiderProfile(insiderUser.id, company.id, "eq2@acme.com");
    await db.identity.markInsiderVerified(insiderProfile.id, new Date());

    const request = await sendRequest(
      { db, queue: spyQueue },
      { idempotencyKey: "eq1", seekerProfileId: seekerProfile.id, insiderProfileId: insiderProfile.id }
    );

    expect(sentJobs).toHaveLength(1);
    expect(sentJobs[0].queueName).toBe("request.expire");
    expect(sentJobs[0].payload).toEqual({ requestId: request.id });
    expect(sentJobs[0].options?.singletonKey).toBe(`request:${request.id}:expire`);
    expect(sentJobs[0].options?.startAfterSeconds).toBe(RULES_VALUE.responseWindowHours * 3600);
  });
});

describe("accept", () => {
  it("moves a SENT request to ACCEPTED with no ledger movement", async () => {
    const { deps, seekerProfileId, insiderProfileId } = await makeVerifiedInsiderAndFundedSeeker(5);
    const request = await sendRequest(deps, { idempotencyKey: "k6", seekerProfileId, insiderProfileId });
    const updated = await accept(deps, request.id);
    expect(updated.state).toBe("ACCEPTED");
    expect(await deps.db.ledger.getBalance("escrow", request.id, "credits")).toBe(3);
  });

  it("throws when accepting a request that is not SENT", async () => {
    const { deps, seekerProfileId, insiderProfileId } = await makeVerifiedInsiderAndFundedSeeker(5);
    const request = await sendRequest(deps, { idempotencyKey: "k7", seekerProfileId, insiderProfileId });
    await accept(deps, request.id);
    await expect(accept(deps, request.id)).rejects.toThrow(InvalidTransitionError);
  });
});

describe("decline", () => {
  it("refunds the full cost to the seeker at 100% refundPercentOnDecline", async () => {
    const { deps, seekerProfileId, insiderProfileId } = await makeVerifiedInsiderAndFundedSeeker(5);
    const request = await sendRequest(deps, { idempotencyKey: "k8", seekerProfileId, insiderProfileId });
    const updated = await decline(deps, request.id);
    expect(updated.state).toBe("DECLINED");
    expect(await deps.db.ledger.getBalance("seeker", seekerProfileId, "credits")).toBe(5);
    expect(await deps.db.ledger.getBalance("escrow", request.id, "credits")).toBe(0);
  });

  it("refunds using the rules_version stamped on the request, not a newer published version", async () => {
    const { db, seedConfig, seedCompany } = createFakeDatabase();
    seedConfig({ key: "rules", version: 1, placeholder: true, value: RULES_VALUE });
    const company = seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const seekerUser = await db.identity.findOrCreateUser("fb-rv-1", "rv1@x.com", "seeker");
    const seekerProfile = await db.identity.createSeekerProfile(seekerUser.id, "RV Seeker");
    await db.ledger.postTxn({
      idempotencyKey: "grant:rv1",
      eventType: "credits.grant",
      entries: [
        { ownerType: "platform", ownerId: "platform", currency: "credits", amount: -5 },
        { ownerType: "seeker", ownerId: seekerProfile.id, currency: "credits", amount: 5 },
      ],
    });
    const insiderUser = await db.identity.findOrCreateUser("fb-rv-2", "rv2@acme.com", "seeker");
    const insiderProfile = await db.identity.findOrCreateInsiderProfile(insiderUser.id, company.id, "rv2@acme.com");
    await db.identity.markInsiderVerified(insiderProfile.id, new Date());
    const deps = { db, queue: createFakeQueueClient() };

    const request = await sendRequest(deps, {
      idempotencyKey: "kv1",
      seekerProfileId: seekerProfile.id,
      insiderProfileId: insiderProfile.id,
    });
    expect(request.rulesVersion).toBe(1);

    // Publish rules v2 with a DIFFERENT refundPercentOnDecline, after the request already exists.
    seedConfig({
      key: "rules",
      version: 2,
      placeholder: true,
      value: { ...RULES_VALUE, refundPercentOnDecline: 0 },
    });

    await decline(deps, request.id);

    // Must still refund at v1's 100%, not v2's 0%.
    expect(await db.ledger.getBalance("seeker", seekerProfile.id, "credits")).toBe(5);
  });
});

describe("expire", () => {
  it("refunds refundPercentOnExpiry (60%) to the seeker and the remainder to the platform", async () => {
    const { deps, seekerProfileId, insiderProfileId } = await makeVerifiedInsiderAndFundedSeeker(5);
    const request = await sendRequest(deps, { idempotencyKey: "k9", seekerProfileId, insiderProfileId });
    const updated = await expire(deps, request.id);
    expect(updated.state).toBe("EXPIRED");
    // creditCost 3, 60% refund = round(1.8) = 2, forfeit = 1
    expect(await deps.db.ledger.getBalance("seeker", seekerProfileId, "credits")).toBe(4);
    expect(await deps.db.ledger.getBalance("platform", "platform", "credits")).toBe(-4); // -5 grant + 1 forfeit
    expect(await deps.db.ledger.getBalance("escrow", request.id, "credits")).toBe(0);
  });

  it("is a no-op when the request is no longer SENT", async () => {
    const { deps, seekerProfileId, insiderProfileId } = await makeVerifiedInsiderAndFundedSeeker(5);
    const request = await sendRequest(deps, { idempotencyKey: "k10", seekerProfileId, insiderProfileId });
    await accept(deps, request.id);

    const result = await expire(deps, request.id);
    expect(result.state).toBe("ACCEPTED");
    expect(await deps.db.ledger.getBalance("seeker", seekerProfileId, "credits")).toBe(2);
  });

  it("is idempotent when called twice on an already-expired request (simulating a retried timer job)", async () => {
    const { deps, seekerProfileId, insiderProfileId } = await makeVerifiedInsiderAndFundedSeeker(5);
    const request = await sendRequest(deps, { idempotencyKey: "k11", seekerProfileId, insiderProfileId });
    const first = await expire(deps, request.id);
    const second = await expire(deps, request.id);
    expect(second.state).toBe(first.state);
    expect(await deps.db.ledger.getBalance("seeker", seekerProfileId, "credits")).toBe(4);
  });

  it("refunds using the rules_version stamped on the request, not a newer published version", async () => {
    const { db, seedConfig, seedCompany } = createFakeDatabase();
    seedConfig({ key: "rules", version: 1, placeholder: true, value: RULES_VALUE });
    const company = seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const seekerUser = await db.identity.findOrCreateUser("fb-rv-3", "rv3@x.com", "seeker");
    const seekerProfile = await db.identity.createSeekerProfile(seekerUser.id, "RV Seeker 2");
    await db.ledger.postTxn({
      idempotencyKey: "grant:rv2",
      eventType: "credits.grant",
      entries: [
        { ownerType: "platform", ownerId: "platform", currency: "credits", amount: -5 },
        { ownerType: "seeker", ownerId: seekerProfile.id, currency: "credits", amount: 5 },
      ],
    });
    const insiderUser = await db.identity.findOrCreateUser("fb-rv-4", "rv4@acme.com", "seeker");
    const insiderProfile = await db.identity.findOrCreateInsiderProfile(insiderUser.id, company.id, "rv4@acme.com");
    await db.identity.markInsiderVerified(insiderProfile.id, new Date());
    const deps = { db, queue: createFakeQueueClient() };

    const request = await sendRequest(deps, {
      idempotencyKey: "kv2",
      seekerProfileId: seekerProfile.id,
      insiderProfileId: insiderProfile.id,
    });
    expect(request.rulesVersion).toBe(1);

    // RULES_VALUE.refundPercentOnExpiry is 60 in this file's constant — publish v2 with 0%.
    seedConfig({
      key: "rules",
      version: 2,
      placeholder: true,
      value: { ...RULES_VALUE, refundPercentOnExpiry: 0 },
    });

    await expire(deps, request.id);

    // creditCost 3, must still refund at v1's 60% (round(1.8)=2), not v2's 0%.
    expect(await db.ledger.getBalance("seeker", seekerProfile.id, "credits")).toBe(4);
  });
});

describe("submitProof", () => {
  it("moves an ACCEPTED request to PROOF_PENDING and records the proof", async () => {
    const { deps, seekerProfileId, insiderProfileId } = await makeVerifiedInsiderAndFundedSeeker(5);
    const request = await sendRequest(deps, { idempotencyKey: "sp1", seekerProfileId, insiderProfileId });
    await accept(deps, request.id);

    const updated = await submitProof(deps, {
      idempotencyKey: "sp1-proof",
      requestId: request.id,
      proofType: "text",
      textContent: "Submitted internally on 2026-09-19",
    });

    expect(updated.state).toBe("PROOF_PENDING");
    const proof = await deps.db.requests.getProofByRequestId(request.id);
    expect(proof?.textContent).toBe("Submitted internally on 2026-09-19");
  });

  it("throws when submitting proof for a request that is not ACCEPTED", async () => {
    const { deps, seekerProfileId, insiderProfileId } = await makeVerifiedInsiderAndFundedSeeker(5);
    const request = await sendRequest(deps, { idempotencyKey: "sp2", seekerProfileId, insiderProfileId });
    // request is still SENT, not ACCEPTED
    await expect(
      submitProof(deps, { idempotencyKey: "sp2-proof", requestId: request.id, proofType: "text", textContent: "x" })
    ).rejects.toThrow(InvalidTransitionError);
  });

  it("allows resubmission after a rejection, using a fresh idempotencyKey each time", async () => {
    const { deps, seekerProfileId, insiderProfileId } = await makeVerifiedInsiderAndFundedSeeker(5);
    const request = await sendRequest(deps, { idempotencyKey: "sp3", seekerProfileId, insiderProfileId });
    await accept(deps, request.id);
    await submitProof(deps, { idempotencyKey: "sp3-proof-1", requestId: request.id, proofType: "text", textContent: "first attempt" });

    // Simulate an admin rejection (PROOF_PENDING -> ACCEPTED) directly via the adapter,
    // since the admin module doesn't exist until this same task builds it below.
    await deps.db.requests.applyTransition({
      idempotencyKey: "review:sp3-reject-1",
      requestId: request.id,
      event: "reject",
      fromState: "PROOF_PENDING",
      toState: "ACCEPTED",
      ledgerEntries: [],
      ledgerEventType: "request.reject",
    });

    const resubmitted = await submitProof(deps, {
      idempotencyKey: "sp3-proof-2",
      requestId: request.id,
      proofType: "text",
      textContent: "second attempt",
    });

    expect(resubmitted.state).toBe("PROOF_PENDING");
    const proof = await deps.db.requests.getProofByRequestId(request.id);
    expect(proof?.textContent).toBe("second attempt");
  });

  it("throws when submitting a screenshot proof with no objectKey, or a text proof with no textContent", async () => {
    const { deps, seekerProfileId, insiderProfileId } = await makeVerifiedInsiderAndFundedSeeker(5);
    const request = await sendRequest(deps, { idempotencyKey: "sp4", seekerProfileId, insiderProfileId });
    await accept(deps, request.id);

    await expect(
      submitProof(deps, { idempotencyKey: "sp4-proof-a", requestId: request.id, proofType: "screenshot" })
    ).rejects.toThrow(MissingProofContentError);
    await expect(
      submitProof(deps, { idempotencyKey: "sp4-proof-b", requestId: request.id, proofType: "text" })
    ).rejects.toThrow(MissingProofContentError);
    await expect(
      submitProof(deps, { idempotencyKey: "sp4-proof-c", requestId: request.id, proofType: "text", textContent: "   " })
    ).rejects.toThrow(MissingProofContentError);
  });
});

describe("sweepExpiredSent", () => {
  it("expires a SENT request whose response window has passed, refunding per config", async () => {
    const { deps, seekerProfileId, insiderProfileId } = await makeVerifiedInsiderAndFundedSeeker(5);
    const request = await sendRequest(deps, { idempotencyKey: "sw1", seekerProfileId, insiderProfileId });
    const past = new Date(Date.now() + (RULES_VALUE.responseWindowHours * 3600 + 60) * 1000);

    const swept = await sweepExpiredSent(deps, past);

    expect(swept.map((r) => r.id)).toContain(request.id);
    const updated = await deps.db.requests.getById(request.id);
    expect(updated?.state).toBe("EXPIRED");
    // creditCost 3 (tier1), refundPercentOnExpiry 60% => round(1.8)=2 refunded on top of the 2 left after the 3-credit debit = 4.
    // (Brief's literal test code asserted 5, i.e. a 100% refund, which contradicts RULES_VALUE.refundPercentOnExpiry=60
    // and the already-passing "expire" describe block's identical-inputs assertion of 4 a few lines above in this same file.)
    expect(await deps.db.ledger.getBalance("seeker", seekerProfileId, "credits")).toBe(4);
  });

  it("does not sweep a SENT request still within its response window", async () => {
    const { deps, seekerProfileId, insiderProfileId } = await makeVerifiedInsiderAndFundedSeeker(5);
    const request = await sendRequest(deps, { idempotencyKey: "sw2", seekerProfileId, insiderProfileId });
    const soon = new Date(Date.now() + 60 * 1000);

    const swept = await sweepExpiredSent(deps, soon);

    expect(swept.map((r) => r.id)).not.toContain(request.id);
    const updated = await deps.db.requests.getById(request.id);
    expect(updated?.state).toBe("SENT");
  });

  it("does not touch a request that is no longer SENT, even if old", async () => {
    const { deps, seekerProfileId, insiderProfileId } = await makeVerifiedInsiderAndFundedSeeker(5);
    const request = await sendRequest(deps, { idempotencyKey: "sw3", seekerProfileId, insiderProfileId });
    await accept(deps, request.id);
    const past = new Date(Date.now() + (RULES_VALUE.responseWindowHours * 3600 + 60) * 1000);

    const swept = await sweepExpiredSent(deps, past);

    expect(swept.map((r) => r.id)).not.toContain(request.id);
    const updated = await deps.db.requests.getById(request.id);
    expect(updated?.state).toBe("ACCEPTED");
  });
});
