import { describe, it, expect, vi } from "vitest";
import { createFakeDatabase } from "../../adapters/db/fake";
import { createFakeQueueClient } from "../../jobs/queue.fake";
import { RedemptionAlreadyResolvedError, type Database } from "../../adapters/db/types";
import type { QueueClient } from "../../jobs/queue";
import type { Rules } from "../config/schemas";
import { computeTranchePoints, RewardsNotConfiguredError } from "../rewards/points";
import { sendRequest, accept, submitProof, type RequestsDeps } from "../requests/requests";
import {
  reviewProof,
  listPendingProofs,
  fulfilRedemption,
  rejectRedemption,
  listRewardRedemptions,
  MissingRejectionReasonError,
  MissingVendorRefError,
  MissingRedemptionReasonError,
  type AdminDeps,
} from "./admin";

const RULES_VALUE: Rules = {
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
  pointsPerCredit: 40,
  paisePerPoint: 100,
  giftCardBrands: ["amazon", "flipkart"],
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

async function makeProofPendingRequest(
  rulesOverride: Partial<Rules> = {}
): Promise<{ deps: AdminDeps & RequestsDeps; requestId: string; insiderProfileId: string }> {
  const { db, seedConfig, seedCompany } = createFakeDatabase();
  seedConfig({ key: "rules", version: 1, placeholder: true, value: { ...RULES_VALUE, ...rulesOverride } });
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

  return { deps, requestId: request.id, insiderProfileId: insiderProfile.id };
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

    // proof.verified to the insider, proof.verified to the seeker, reward.released to the insider.
    expect(notificationIds).toHaveLength(3);
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
    // insider proof.verified (fails), seeker proof.verified (succeeds), insider reward.released (succeeds).
    expect(notifyCalls).toBe(3);
    expect(notificationIds).toHaveLength(2);
    const request = await deps.db.requests.getById(requestId);
    const seekerProfile = await deps.db.identity.getSeekerProfileById(request!.seekerProfileId);
    const record = await deps.db.notifications.getById(notificationIds[0]);
    expect(record?.userId).toBe(seekerProfile!.userId);
    expect(record?.payload).toMatchObject({ audience: "seeker" });
    consoleError.mockRestore();
  });

  it("does not send second notifications when a racing caller replays the same verify", async () => {
    const { deps, requestId, insiderProfileId } = await makeProofPendingRequest();
    const { queue, notificationIds } = recordNotifySends(deps.queue);
    const recordingDeps: AdminDeps = { db: deps.db, queue };
    const staleSnapshot = { ...(await deps.db.requests.getById(requestId))! }; // copy: the fake returns live rows; still PROOF_PENDING
    const input = { idempotencyKey: "replayrev1", adminUserId: "admin-1", requestId, decision: "verify" as const };

    await reviewProof(recordingDeps, input);
    expect(notificationIds).toHaveLength(3);

    // Second caller read the request before the first committed, so it passes
    // the state check and reaches applyTransition's idempotent-replay branch.
    const racingDb: Database = {
      ...deps.db,
      requests: { ...deps.db.requests, getById: async () => staleSnapshot },
    };
    const replayed = await reviewProof({ db: racingDb, queue }, input);

    expect(replayed.state).toBe("SUBMITTED");
    expect(notificationIds).toHaveLength(3);
    expect(await deps.db.rewards.listRewards(insiderProfileId)).toHaveLength(1);
  });

  it("releases tranche 1 to the insider's wallet atomically on verify", async () => {
    const { deps, requestId, insiderProfileId } = await makeProofPendingRequest();

    const updated = await reviewProof(deps, {
      idempotencyKey: "tranche1",
      adminUserId: "admin-1",
      requestId,
      decision: "verify",
    });

    const expectedPoints = computeTranchePoints(RULES_VALUE, 3, 1);
    expect(updated.state).toBe("SUBMITTED");

    const wallet = await deps.db.rewards.getWallet(insiderProfileId);
    expect(wallet.balance).toBe(expectedPoints);
    expect(wallet.lifetimeEarned).toBe(expectedPoints);

    const rewards = await deps.db.rewards.listRewards(insiderProfileId);
    expect(rewards).toHaveLength(1);
    expect(rewards[0]).toMatchObject({ requestId, tranche: 1, points: expectedPoints });
  });

  it("throws RewardsNotConfiguredError and changes nothing when the rules lack pointsPerCredit", async () => {
    const { deps, requestId, insiderProfileId } = await makeProofPendingRequest({ pointsPerCredit: undefined });

    await expect(
      reviewProof(deps, { idempotencyKey: "noconfig1", adminUserId: "admin-1", requestId, decision: "verify" })
    ).rejects.toThrow(RewardsNotConfiguredError);

    expect((await deps.db.requests.getById(requestId))?.state).toBe("PROOF_PENDING");
    expect(await deps.db.requests.listAuditLogByTarget("insider_request", requestId)).toHaveLength(0);
    expect(await deps.db.rewards.listRewards(insiderProfileId)).toHaveLength(0);
  });

  it("sends reward.released to the insider on verify", async () => {
    const { deps, requestId, insiderProfileId } = await makeProofPendingRequest();
    const { queue, notificationIds } = recordNotifySends(deps.queue);
    const recordingDeps: AdminDeps = { db: deps.db, queue };

    await reviewProof(recordingDeps, { idempotencyKey: "rewardrel1", adminUserId: "admin-1", requestId, decision: "verify" });

    const insiderProfile = await deps.db.identity.getInsiderProfileById(insiderProfileId);
    const records = await Promise.all(notificationIds.map((id) => deps.db.notifications.getById(id)));
    const rewardRecord = records.find((r) => r?.template === "reward.released");
    expect(rewardRecord?.userId).toBe(insiderProfile!.userId);
    expect(rewardRecord?.payload).toMatchObject({ tranche: 1, points: computeTranchePoints(RULES_VALUE, 3, 1) });
  });

  it("still verifies and releases tranche 1 when the reward.released notify fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps, requestId, insiderProfileId } = await makeProofPendingRequest();
    const failingDeps: AdminDeps = {
      db: deps.db,
      queue: {
        ...deps.queue,
        async send(queueName, payload, options) {
          if (queueName === "notify.send") {
            const body = payload as { notificationId: string };
            const record = await deps.db.notifications.getById(body.notificationId);
            if (record?.template === "reward.released") throw new Error("queue unavailable");
          }
          return deps.queue.send(queueName, payload, options);
        },
      },
    };

    const updated = await reviewProof(failingDeps, {
      idempotencyKey: "rewardfail1",
      adminUserId: "admin-1",
      requestId,
      decision: "verify",
    });

    expect(updated.state).toBe("SUBMITTED");
    expect(await deps.db.rewards.listRewards(insiderProfileId)).toHaveLength(1);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("verifies without releasing a reward when tranche1Percent is 0", async () => {
    const { deps, requestId, insiderProfileId } = await makeProofPendingRequest({ tranche1Percent: 0 });
    const { queue, notificationIds } = recordNotifySends(deps.queue);
    const recordingDeps: AdminDeps = { db: deps.db, queue };

    const updated = await reviewProof(recordingDeps, {
      idempotencyKey: "notranche1",
      adminUserId: "admin-1",
      requestId,
      decision: "verify",
    });

    expect(updated.state).toBe("SUBMITTED");
    expect(await deps.db.rewards.listRewards(insiderProfileId)).toHaveLength(0);
    expect(notificationIds).toHaveLength(2);
    const records = await Promise.all(notificationIds.map((id) => deps.db.notifications.getById(id)));
    expect(records.some((r) => r?.template === "reward.released")).toBe(false);
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

async function makePendingRedemption(
  points = 500
): Promise<{ db: Database; queue: QueueClient; insiderProfileId: string; insiderUserId: string; redemptionId: string }> {
  const { db, seedConfig, seedCompany } = createFakeDatabase();
  seedConfig({ key: "rules", version: 1, placeholder: true, value: RULES_VALUE });
  const company = seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);

  const insiderUser = await db.identity.findOrCreateUser(`fb-adm-red-${Math.random()}`, `r${Math.random()}@acme.com`, "seeker");
  const insiderProfile = await db.identity.findOrCreateInsiderProfile(insiderUser.id, company.id, `r${Math.random()}@acme.com`);
  await db.identity.markInsiderVerified(insiderProfile.id, new Date());

  await db.ledger.postTxn({
    idempotencyKey: `grant-points:${insiderProfile.id}:${points}`,
    eventType: "reward.tranche",
    entries: [
      { ownerType: "platform", ownerId: "platform", currency: "points", amount: -points },
      { ownerType: "insider", ownerId: insiderProfile.id, currency: "points", amount: points },
    ],
  });

  const { redemption } = await db.rewards.createRedemption({
    idempotencyKey: `redeem:${insiderProfile.id}:${points}`,
    insiderProfileId: insiderProfile.id,
    points,
    brand: "amazon",
    denominationPaise: points * RULES_VALUE.paisePerPoint!,
    vendor: "manual",
  });

  return {
    db,
    queue: createFakeQueueClient(),
    insiderProfileId: insiderProfile.id,
    insiderUserId: insiderUser.id,
    redemptionId: redemption.id,
  };
}

describe("redemption actions", () => {
  describe("fulfilRedemption", () => {
    it("resolves the redemption, moves escrow to the platform, and audits", async () => {
      const { db, queue, redemptionId } = await makePendingRedemption(500);
      const deps: AdminDeps = { db, queue };

      const resolved = await fulfilRedemption(deps, { adminUserId: "admin-1", redemptionId, vendorRef: "GC-123" });

      expect(resolved.status).toBe("fulfilled");
      expect(resolved.vendorRef).toBe("GC-123");
      expect(await db.ledger.getBalance("escrow", redemptionId, "points")).toBe(0);

      const auditRows = await db.requests.listAuditLogByTarget("reward_redemption", redemptionId);
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].action).toBe("redemption.fulfil");
      expect(auditRows[0].adminUserId).toBe("admin-1");
      expect(auditRows[0].detail).toBe("GC-123");
    });

    it("notifies the insider with redemption.fulfilled", async () => {
      const { db, queue: baseQueue, insiderUserId, redemptionId } = await makePendingRedemption(500);
      const { queue, notificationIds } = recordNotifySends(baseQueue);
      const deps: AdminDeps = { db, queue };

      await fulfilRedemption(deps, { adminUserId: "admin-1", redemptionId, vendorRef: "GC-123" });

      expect(notificationIds).toHaveLength(1);
      const record = await db.notifications.getById(notificationIds[0]);
      expect(record?.userId).toBe(insiderUserId);
      expect(record?.template).toBe("redemption.fulfilled");
      expect(record?.payload).toMatchObject({ redemptionId, points: 500, brand: "amazon" });
    });

    it("requires a non-empty vendorRef and changes nothing", async () => {
      const { db, queue, redemptionId } = await makePendingRedemption(500);
      const deps: AdminDeps = { db, queue };

      await expect(fulfilRedemption(deps, { adminUserId: "admin-1", redemptionId, vendorRef: "   " })).rejects.toThrow(
        MissingVendorRefError
      );

      const row = await db.rewards.getRedemptionById(redemptionId);
      expect(row?.status).toBe("pending");
      expect(await db.requests.listAuditLogByTarget("reward_redemption", redemptionId)).toHaveLength(0);
    });

    it("replaying the same fulfil returns the row and sends no second notification", async () => {
      const { db, queue: baseQueue, redemptionId } = await makePendingRedemption(500);
      const { queue, notificationIds } = recordNotifySends(baseQueue);
      const deps: AdminDeps = { db, queue };

      await fulfilRedemption(deps, { adminUserId: "admin-1", redemptionId, vendorRef: "GC-123" });
      expect(notificationIds).toHaveLength(1);

      const replayed = await fulfilRedemption(deps, { adminUserId: "admin-1", redemptionId, vendorRef: "GC-123" });
      expect(replayed.status).toBe("fulfilled");
      expect(notificationIds).toHaveLength(1);
    });

    it("throws RedemptionAlreadyResolvedError when the redemption was already rejected", async () => {
      const { db, queue, redemptionId } = await makePendingRedemption(500);
      const deps: AdminDeps = { db, queue };
      await rejectRedemption(deps, { adminUserId: "admin-1", redemptionId, reason: "duplicate" });

      await expect(fulfilRedemption(deps, { adminUserId: "admin-1", redemptionId, vendorRef: "GC-1" })).rejects.toThrow(
        RedemptionAlreadyResolvedError
      );
    });

    it("never fails when notify.send throws", async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      const { db, queue: baseQueue, redemptionId } = await makePendingRedemption(500);
      const failingQueue: QueueClient = {
        ...baseQueue,
        async send(queueName, payload, options) {
          if (queueName === "notify.send") throw new Error("queue unavailable");
          return baseQueue.send(queueName, payload, options);
        },
      };
      const deps: AdminDeps = { db, queue: failingQueue };

      const resolved = await fulfilRedemption(deps, { adminUserId: "admin-1", redemptionId, vendorRef: "GC-9" });

      expect(resolved.status).toBe("fulfilled");
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });
  });

  describe("rejectRedemption", () => {
    it("restores points, audits, and notifies redemption.rejected", async () => {
      const { db, queue: baseQueue, insiderProfileId, insiderUserId, redemptionId } = await makePendingRedemption(500);
      const { queue, notificationIds } = recordNotifySends(baseQueue);
      const deps: AdminDeps = { db, queue };

      const resolved = await rejectRedemption(deps, { adminUserId: "admin-1", redemptionId, reason: "duplicate request" });

      expect(resolved.status).toBe("rejected");
      expect(resolved.rejectReason).toBe("duplicate request");
      expect(await db.ledger.getBalance("insider", insiderProfileId, "points")).toBe(500);

      const auditRows = await db.requests.listAuditLogByTarget("reward_redemption", redemptionId);
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].action).toBe("redemption.reject");
      expect(auditRows[0].detail).toBe("duplicate request");

      expect(notificationIds).toHaveLength(1);
      const record = await db.notifications.getById(notificationIds[0]);
      expect(record?.userId).toBe(insiderUserId);
      expect(record?.template).toBe("redemption.rejected");
      expect(record?.payload).toMatchObject({ points: 500, reason: "duplicate request" });
    });

    it("requires a non-empty reason and changes nothing", async () => {
      const { db, queue, redemptionId } = await makePendingRedemption(500);
      const deps: AdminDeps = { db, queue };

      await expect(rejectRedemption(deps, { adminUserId: "admin-1", redemptionId, reason: "   " })).rejects.toThrow(
        MissingRedemptionReasonError
      );

      const row = await db.rewards.getRedemptionById(redemptionId);
      expect(row?.status).toBe("pending");
      expect(await db.requests.listAuditLogByTarget("reward_redemption", redemptionId)).toHaveLength(0);
    });

    it("replaying the same reject returns the row and sends no second notification", async () => {
      const { db, queue: baseQueue, redemptionId } = await makePendingRedemption(500);
      const { queue, notificationIds } = recordNotifySends(baseQueue);
      const deps: AdminDeps = { db, queue };

      await rejectRedemption(deps, { adminUserId: "admin-1", redemptionId, reason: "duplicate" });
      expect(notificationIds).toHaveLength(1);

      const replayed = await rejectRedemption(deps, { adminUserId: "admin-1", redemptionId, reason: "duplicate" });
      expect(replayed.status).toBe("rejected");
      expect(notificationIds).toHaveLength(1);
    });

    it("throws RedemptionAlreadyResolvedError when the redemption was already fulfilled", async () => {
      const { db, queue, redemptionId } = await makePendingRedemption(500);
      const deps: AdminDeps = { db, queue };
      await fulfilRedemption(deps, { adminUserId: "admin-1", redemptionId, vendorRef: "GC-1" });

      await expect(rejectRedemption(deps, { adminUserId: "admin-1", redemptionId, reason: "oops" })).rejects.toThrow(
        RedemptionAlreadyResolvedError
      );
    });

    it("never fails when notify.send throws", async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      const { db, queue: baseQueue, redemptionId } = await makePendingRedemption(500);
      const failingQueue: QueueClient = {
        ...baseQueue,
        async send(queueName, payload, options) {
          if (queueName === "notify.send") throw new Error("queue unavailable");
          return baseQueue.send(queueName, payload, options);
        },
      };
      const deps: AdminDeps = { db, queue: failingQueue };

      const resolved = await rejectRedemption(deps, { adminUserId: "admin-1", redemptionId, reason: "oops" });

      expect(resolved.status).toBe("rejected");
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });
  });

  describe("listRewardRedemptions", () => {
    it("filters by status and returns newest first", async () => {
      const { db, queue, insiderProfileId, redemptionId: firstId } = await makePendingRedemption(500);
      const deps: AdminDeps = { db, queue };
      await fulfilRedemption(deps, { adminUserId: "admin-1", redemptionId: firstId, vendorRef: "GC-1" });

      // Grant more points and create a second, still-pending redemption for the same insider.
      await db.ledger.postTxn({
        idempotencyKey: `grant-points:${insiderProfileId}:more`,
        eventType: "reward.tranche",
        entries: [
          { ownerType: "platform", ownerId: "platform", currency: "points", amount: -500 },
          { ownerType: "insider", ownerId: insiderProfileId, currency: "points", amount: 500 },
        ],
      });
      const { redemption: second } = await db.rewards.createRedemption({
        idempotencyKey: `redeem:${insiderProfileId}:more`,
        insiderProfileId,
        points: 500,
        brand: "amazon",
        denominationPaise: 500 * RULES_VALUE.paisePerPoint!,
        vendor: "manual",
      });

      const pending = await listRewardRedemptions({ db }, "pending");
      expect(pending.map((r) => r.id)).toEqual([second.id]);

      const fulfilled = await listRewardRedemptions({ db }, "fulfilled");
      expect(fulfilled.map((r) => r.id)).toEqual([firstId]);

      const all = await listRewardRedemptions({ db });
      expect(all.map((r) => r.id)).toEqual([second.id, firstId]);
    });
  });
});
