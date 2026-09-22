import { describe, it, expect } from "vitest";
import { createFakeDatabase } from "../../adapters/db/fake";
import { createFakeQueueClient } from "../../jobs/queue.fake";
import { sendRequest, accept, submitProof, type RequestsDeps } from "../requests/requests";
import { reviewProof, listPendingProofs, MissingRejectionReasonError, type AdminDeps } from "./admin";

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

async function makeProofPendingRequest(): Promise<{ deps: AdminDeps & RequestsDeps; requestId: string }> {
  const { db, seedConfig, seedCompany } = createFakeDatabase();
  seedConfig({ key: "rules", version: 1, placeholder: true, value: RULES_VALUE });
  const company = seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);

  const seekerUser = await db.identity.findOrCreateUser(`fb-adm-s-${Math.random()}`, `s${Math.random()}@x.com`, "seeker");
  const seekerProfile = await db.identity.createSeekerProfile(seekerUser.id, "Admin Test Seeker");
  await db.ledger.postTxn({
    idempotencyKey: `grant:${seekerProfile.id}`,
    eventType: "credits.grant",
    entries: [
      { ownerType: "platform", ownerId: "platform", currency: "credits", amount: -5 },
      { ownerType: "seeker", ownerId: seekerProfile.id, currency: "credits", amount: 5 },
    ],
  });

  const insiderUser = await db.identity.findOrCreateUser(`fb-adm-i-${Math.random()}`, `i${Math.random()}@acme.com`, "seeker");
  const insiderProfile = await db.identity.findOrCreateInsiderProfile(insiderUser.id, company.id, `i${Math.random()}@acme.com`);
  await db.identity.markInsiderVerified(insiderProfile.id, new Date());

  const deps = { db, queue: createFakeQueueClient() };
  const request = await sendRequest(deps, {
    idempotencyKey: `send:${seekerProfile.id}`,
    seekerProfileId: seekerProfile.id,
    insiderProfileId: insiderProfile.id,
  });
  await accept(deps, request.id);
  await submitProof(deps, { idempotencyKey: `proof:${request.id}`, requestId: request.id, proofType: "text", textContent: "proof text" });

  return { deps, requestId: request.id };
}

describe("reviewProof", () => {
  it("verify moves PROOF_PENDING to SUBMITTED and writes an audit log entry", async () => {
    const { deps, requestId } = await makeProofPendingRequest();
    const updated = await reviewProof(deps, {
      idempotencyKey: "rev1",
      adminUserId: "admin-1",
      requestId,
      decision: "verify",
    });
    expect(updated.state).toBe("SUBMITTED");

    const auditRows = await deps.db.requests.listAuditLogByTarget("insider_request", requestId);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].action).toBe("proof.verify");
    expect(auditRows[0].adminUserId).toBe("admin-1");
  });

  it("reject moves PROOF_PENDING back to ACCEPTED and requires a reason", async () => {
    const { deps, requestId } = await makeProofPendingRequest();
    await expect(
      reviewProof(deps, { idempotencyKey: "rev2", adminUserId: "admin-1", requestId, decision: "reject" })
    ).rejects.toThrow(MissingRejectionReasonError);

    const updated = await reviewProof(deps, {
      idempotencyKey: "rev3",
      adminUserId: "admin-1",
      requestId,
      decision: "reject",
      reason: "Screenshot was unreadable",
    });
    expect(updated.state).toBe("ACCEPTED");

    const auditRows = await deps.db.requests.listAuditLogByTarget("insider_request", requestId);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].action).toBe("proof.reject");
    expect(auditRows[0].detail).toBe("Screenshot was unreadable");
  });

  it("supports reject, resubmit, reject again — each with its own idempotencyKey", async () => {
    const { deps, requestId } = await makeProofPendingRequest();
    await reviewProof(deps, { idempotencyKey: "rev4", adminUserId: "admin-1", requestId, decision: "reject", reason: "first reject" });
    await submitProof(deps, { idempotencyKey: `proof:${requestId}:2`, requestId, proofType: "text", textContent: "resubmission" });
    const secondReject = await reviewProof(deps, {
      idempotencyKey: "rev5",
      adminUserId: "admin-1",
      requestId,
      decision: "reject",
      reason: "second reject",
    });
    expect(secondReject.state).toBe("ACCEPTED");
  });
});

describe("listPendingProofs", () => {
  it("returns requests in PROOF_PENDING with their proof content", async () => {
    const { deps, requestId } = await makeProofPendingRequest();
    const pending = await listPendingProofs(deps);
    expect(pending).toHaveLength(1);
    expect(pending[0].request.id).toBe(requestId);
    expect(pending[0].proof?.textContent).toBe("proof text");
  });

  it("returns an empty list when nothing is pending", async () => {
    const { db } = createFakeDatabase();
    expect(await listPendingProofs({ db })).toEqual([]);
  });
});
