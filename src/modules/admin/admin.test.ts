import { describe, it, expect, vi } from "vitest";
import { createFakeDatabase } from "../../adapters/db/fake";
import { createFakeQueueClient } from "../../jobs/queue.fake";
import type { Database } from "../../adapters/db/types";
import type { QueueClient } from "../../jobs/queue";
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

// Records the notificationId of every "notify.send" job that is enqueued, so tests can look the rows up.
function recordNotifySends(base: QueueClient): { queue: QueueClient; notificationIds: string[] } {
  const notificationIds: string[] = [];
  const queue: QueueClient = {
    ...base,
    async send(queueName, payload, options) {
      if (queueName === "notify.send") notificationIds.push((payload as { notificationId: string }).notificationId);
      return base.send(queueName, payload, options);
    },
  };
  return { queue, notificationIds };
}

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

  it("notifies the insider and the seeker on verify, each with the right audience", async () => {
    const { deps, requestId } = await makeProofPendingRequest();
    const { queue, notificationIds } = recordNotifySends(deps.queue);
    const recordingDeps: AdminDeps = { db: deps.db, queue };

    await reviewProof(recordingDeps, { idempotencyKey: "notifrev1", adminUserId: "admin-1", requestId, decision: "verify" });

    expect(notificationIds).toHaveLength(2);
    const request = await deps.db.requests.getById(requestId);
    const insiderProfile = await deps.db.identity.getInsiderProfileById(request!.insiderProfileId);
    const seekerProfile = await deps.db.identity.getSeekerProfileById(request!.seekerProfileId);
    const records = await Promise.all(notificationIds.map((id) => deps.db.notifications.getById(id)));
    const insiderRecord = records.find((r) => r?.userId === insiderProfile!.userId);
    const seekerRecord = records.find((r) => r?.userId === seekerProfile!.userId);
    expect(insiderRecord?.template).toBe("proof.verified");
    expect(insiderRecord?.payload).toMatchObject({ audience: "insider" });
    expect(seekerRecord?.template).toBe("proof.verified");
    expect(seekerRecord?.payload).toMatchObject({ audience: "seeker" });
  });

  it("notifies only the insider on reject", async () => {
    const { deps, requestId } = await makeProofPendingRequest();
    const { queue, notificationIds } = recordNotifySends(deps.queue);
    const recordingDeps: AdminDeps = { db: deps.db, queue };

    await reviewProof(recordingDeps, {
      idempotencyKey: "notifrev2",
      adminUserId: "admin-1",
      requestId,
      decision: "reject",
      reason: "Screenshot was unreadable",
    });

    expect(notificationIds).toHaveLength(1);
    const request = await deps.db.requests.getById(requestId);
    const insiderProfile = await deps.db.identity.getInsiderProfileById(request!.insiderProfileId);
    const record = await deps.db.notifications.getById(notificationIds[0]);
    expect(record?.userId).toBe(insiderProfile!.userId);
    expect(record?.template).toBe("proof.rejected");
    expect(record?.payload).toMatchObject({ reason: "Screenshot was unreadable" });
  });

  it("still verifies the proof and returns normally when every notify() fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps, requestId } = await makeProofPendingRequest();
    const failingDeps: AdminDeps = {
      db: deps.db,
      queue: {
        ...deps.queue,
        async send(queueName, payload, options) {
          if (queueName === "notify.send") throw new Error("queue unavailable");
          return deps.queue.send(queueName, payload, options);
        },
      },
    };

    const updated = await reviewProof(failingDeps, {
      idempotencyKey: "notiffail1",
      adminUserId: "admin-1",
      requestId,
      decision: "verify",
    });

    expect(updated.state).toBe("SUBMITTED");
    expect((await deps.db.requests.getById(requestId))?.state).toBe("SUBMITTED");
    expect(await deps.db.requests.listAuditLogByTarget("insider_request", requestId)).toHaveLength(1);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("still notifies the seeker when the insider notify() fails on verify", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps, requestId } = await makeProofPendingRequest();
    const { queue, notificationIds } = recordNotifySends(deps.queue);
    let notifyCalls = 0;
    const flakyDeps: AdminDeps = {
      db: deps.db,
      queue: {
        ...queue,
        async send(queueName, payload, options) {
          if (queueName === "notify.send") {
            notifyCalls += 1;
            if (notifyCalls === 1) throw new Error("queue unavailable");
          }
          return queue.send(queueName, payload, options);
        },
      },
    };

    const updated = await reviewProof(flakyDeps, { idempotencyKey: "notiffail2", adminUserId: "admin-1", requestId, decision: "verify" });

    expect(updated.state).toBe("SUBMITTED");
    expect(notifyCalls).toBe(2);
    expect(notificationIds).toHaveLength(1);
    const request = await deps.db.requests.getById(requestId);
    const seekerProfile = await deps.db.identity.getSeekerProfileById(request!.seekerProfileId);
    const record = await deps.db.notifications.getById(notificationIds[0]);
    expect(record?.userId).toBe(seekerProfile!.userId);
    expect(record?.payload).toMatchObject({ audience: "seeker" });
    consoleError.mockRestore();
  });

  it("does not send second notifications when a racing caller replays the same verify", async () => {
    const { deps, requestId } = await makeProofPendingRequest();
    const { queue, notificationIds } = recordNotifySends(deps.queue);
    const recordingDeps: AdminDeps = { db: deps.db, queue };
    const staleSnapshot = { ...(await deps.db.requests.getById(requestId))! }; // copy: the fake returns live rows; still PROOF_PENDING
    const input = { idempotencyKey: "replayrev1", adminUserId: "admin-1", requestId, decision: "verify" as const };

    await reviewProof(recordingDeps, input);
    expect(notificationIds).toHaveLength(2);

    // Second caller read the request before the first committed, so it passes
    // the state check and reaches applyTransition's idempotent-replay branch.
    const racingDb: Database = {
      ...deps.db,
      requests: { ...deps.db.requests, getById: async () => staleSnapshot },
    };
    const replayed = await reviewProof({ db: racingDb, queue }, input);

    expect(replayed.state).toBe("SUBMITTED");
    expect(notificationIds).toHaveLength(2);
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
    expect(await listPendingProofs({ db, queue: createFakeQueueClient() })).toEqual([]);
  });
});
