import { describe, it, expect, vi, afterEach } from "vitest";
import { createFakeDatabase } from "../../adapters/db/fake";
import { InsufficientPointsError, type Database } from "../../adapters/db/types";
import { createFakeQueueClient } from "../../jobs/queue.fake";
import type { QueueClient } from "../../jobs/queue";
import { createFakeGiftCardVendor } from "../../adapters/giftcards/fake";
import { RewardsNotConfiguredError } from "./points";
import {
  releaseTranche,
  getWallet,
  listRewards,
  listRedemptions,
  requestRedemption,
  notifyInsiderOrLog,
  BelowMinimumRedemptionError,
  UnknownBrandError,
  type RewardsDeps,
} from "./rewards";

const BASE = {
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

async function setup(): Promise<{
  db: Database;
  seedConfig: ReturnType<typeof createFakeDatabase>["seedConfig"];
  insiderProfileId: string;
  seekerProfileId: string;
}> {
  const { db, seedConfig, seedCompany } = createFakeDatabase();
  seedConfig({ key: "rules", version: 1, placeholder: true, value: BASE });
  const company = seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);

  const seekerUser = await db.identity.findOrCreateUser(`fb-s-${Math.random()}`, `s${Math.random()}@x.com`, "seeker");
  const seekerProfile = await db.identity.createSeekerProfile(seekerUser.id, "Seeker One");
  await db.ledger.postTxn({
    idempotencyKey: `grant:${seekerProfile.id}`,
    eventType: "credits.grant",
    entries: [
      { ownerType: "platform", ownerId: "platform", currency: "credits", amount: -10 },
      { ownerType: "seeker", ownerId: seekerProfile.id, currency: "credits", amount: 10 },
    ],
  });

  const insiderUser = await db.identity.findOrCreateUser(`fb-i-${Math.random()}`, `i${Math.random()}@acme.com`, "seeker");
  const insiderProfile = await db.identity.findOrCreateInsiderProfile(insiderUser.id, company.id, `i${Math.random()}@acme.com`);
  await db.identity.markInsiderVerified(insiderProfile.id, new Date());

  return { db, seedConfig, insiderProfileId: insiderProfile.id, seekerProfileId: seekerProfile.id };
}

async function makeRequest(
  db: Database,
  seekerProfileId: string,
  insiderProfileId: string,
  companyId: string,
  creditCost: number,
  rulesVersion: number,
  idempotencyKey: string
) {
  return db.requests.sendRequest({
    idempotencyKey,
    seekerProfileId,
    insiderProfileId,
    companyId,
    creditCost,
    rulesVersion,
  });
}

async function grantPoints(db: Database, insiderProfileId: string, amount: number): Promise<void> {
  await db.ledger.postTxn({
    idempotencyKey: `grant:points:${insiderProfileId}:${Math.random()}`,
    eventType: "points.grant",
    entries: [
      { ownerType: "platform", ownerId: "platform", currency: "points", amount: -amount },
      { ownerType: "insider", ownerId: insiderProfileId, currency: "points", amount },
    ],
  });
}

function makeDeps(db: Database, giftCards = createFakeGiftCardVendor().vendor): RewardsDeps {
  return { db, queue: createFakeQueueClient(), giftCards };
}

// Backstop for every vi.spyOn in this file (console.error mocks, db method spies): guarantees
// restoration even if an assertion throws before a test's own explicit mockRestore() runs, so a
// failing test can never leak a mocked console.error or spied db method into the next test.
afterEach(() => {
  vi.restoreAllMocks();
});

describe("releaseTranche", () => {
  it("computes points using the request's stamped rules version, not the latest", async () => {
    const { db, seedConfig, seekerProfileId, insiderProfileId } = await setup();
    seedConfig({ key: "rules", version: 2, placeholder: true, value: { ...BASE, pointsPerCredit: 999 } });
    const companyRow = (await db.identity.getInsiderProfileById(insiderProfileId))!;
    const request = await makeRequest(db, seekerProfileId, insiderProfileId, companyRow.companyId, 3, 1, "send1");

    const deps = makeDeps(db);
    const reward = await releaseTranche(deps, { requestId: request.id, tranche: 1 });

    // creditCost 3 * pointsPerCredit 40 * tranche1Percent 50% = 60, using v1 — not v2's 999.
    expect(reward?.points).toBe(60);
  });

  it("returns null when the tranche percent yields 0 points", async () => {
    const { db, seedConfig, seekerProfileId, insiderProfileId } = await setup();
    seedConfig({ key: "rules", version: 3, placeholder: true, value: { ...BASE, tranche2Percent: 0 } });
    const companyRow = (await db.identity.getInsiderProfileById(insiderProfileId))!;
    const request = await makeRequest(db, seekerProfileId, insiderProfileId, companyRow.companyId, 3, 3, "send2");

    const deps = makeDeps(db);
    const reward = await releaseTranche(deps, { requestId: request.id, tranche: 2 });

    expect(reward).toBeNull();
    expect(await db.rewards.listRewards(insiderProfileId)).toEqual([]);
  });

  it("is idempotent: a second call for the same request and tranche returns the same reward", async () => {
    const { db, seekerProfileId, insiderProfileId } = await setup();
    const companyRow = (await db.identity.getInsiderProfileById(insiderProfileId))!;
    const request = await makeRequest(db, seekerProfileId, insiderProfileId, companyRow.companyId, 3, 1, "send3");

    const deps = makeDeps(db);
    const first = await releaseTranche(deps, { requestId: request.id, tranche: 1 });
    const second = await releaseTranche(deps, { requestId: request.id, tranche: 1 });

    expect(second?.id).toBe(first?.id);
    expect(await db.rewards.listRewards(insiderProfileId)).toHaveLength(1);
  });

  it("throws when the request does not exist", async () => {
    const { db } = await setup();
    const deps = makeDeps(db);
    await expect(releaseTranche(deps, { requestId: "does-not-exist", tranche: 1 })).rejects.toThrow();
  });

  it("does not send any notification itself", async () => {
    const { db, seekerProfileId, insiderProfileId } = await setup();
    const companyRow = (await db.identity.getInsiderProfileById(insiderProfileId))!;
    const request = await makeRequest(db, seekerProfileId, insiderProfileId, companyRow.companyId, 3, 1, "send4");

    const deps = makeDeps(db);
    const { queue, notificationIds } = recordNotifySends(deps.queue);
    await releaseTranche({ ...deps, queue }, { requestId: request.id, tranche: 1 });

    expect(notificationIds).toHaveLength(0);
  });
});

describe("wallet and list reads", () => {
  it("getWallet passes through to db.rewards.getWallet", async () => {
    const { db, insiderProfileId } = await setup();
    await grantPoints(db, insiderProfileId, 100);
    expect(await getWallet({ db }, insiderProfileId)).toEqual(await db.rewards.getWallet(insiderProfileId));
  });

  it("listRewards passes through to db.rewards.listRewards", async () => {
    const { db, seekerProfileId, insiderProfileId } = await setup();
    const companyRow = (await db.identity.getInsiderProfileById(insiderProfileId))!;
    const request = await makeRequest(db, seekerProfileId, insiderProfileId, companyRow.companyId, 3, 1, "send5");
    const deps = makeDeps(db);
    await releaseTranche(deps, { requestId: request.id, tranche: 1 });

    expect(await listRewards({ db }, insiderProfileId)).toEqual(await db.rewards.listRewards(insiderProfileId));
  });

  it("listRedemptions passes through to db.rewards.listRedemptions filtered by insider", async () => {
    const { db, insiderProfileId } = await setup();
    await grantPoints(db, insiderProfileId, 1000);
    const deps = makeDeps(db);
    await requestRedemption(deps, { idempotencyKey: "rd1", insiderProfileId, points: 500, brand: "amazon" });

    expect(await listRedemptions({ db }, insiderProfileId)).toEqual(
      await db.rewards.listRedemptions({ insiderProfileId })
    );
  });
});

describe("requestRedemption", () => {
  it("happy path: creates a pending redemption, calls the vendor once, and holds the points", async () => {
    const { db, insiderProfileId } = await setup();
    await grantPoints(db, insiderProfileId, 600);
    const fakeVendor = createFakeGiftCardVendor();
    const deps = makeDeps(db, fakeVendor.vendor);

    const redemption = await requestRedemption(deps, { idempotencyKey: "r1", insiderProfileId, points: 500, brand: "amazon" });

    expect(redemption.status).toBe("pending");
    expect(redemption.denominationPaise).toBe(50000);
    expect(fakeVendor.issued).toHaveLength(1);
    expect(fakeVendor.issued[0]).toEqual({ redemptionId: redemption.id, brand: "amazon", denominationPaise: 50000 });

    const wallet = await db.rewards.getWallet(insiderProfileId);
    expect(wallet.balance).toBe(100);
    expect(wallet.pendingRedemptionPoints).toBe(500);
  });

  it("rejects a redemption below the configured minimum", async () => {
    const { db, insiderProfileId } = await setup();
    await grantPoints(db, insiderProfileId, 600);
    const deps = makeDeps(db);

    await expect(
      requestRedemption(deps, { idempotencyKey: "r2", insiderProfileId, points: 499, brand: "amazon" })
    ).rejects.toThrow(BelowMinimumRedemptionError);
    expect(await db.rewards.listRedemptions({ insiderProfileId })).toEqual([]);
  });

  it("rejects non-integer, zero, and negative point amounts", async () => {
    const { db, insiderProfileId } = await setup();
    await grantPoints(db, insiderProfileId, 600);
    const deps = makeDeps(db);

    await expect(
      requestRedemption(deps, { idempotencyKey: "r3a", insiderProfileId, points: 500.5, brand: "amazon" })
    ).rejects.toThrow(BelowMinimumRedemptionError);
    await expect(
      requestRedemption(deps, { idempotencyKey: "r3b", insiderProfileId, points: 0, brand: "amazon" })
    ).rejects.toThrow(BelowMinimumRedemptionError);
    await expect(
      requestRedemption(deps, { idempotencyKey: "r3c", insiderProfileId, points: -500, brand: "amazon" })
    ).rejects.toThrow(BelowMinimumRedemptionError);
  });

  it("rejects an unknown gift-card brand", async () => {
    const { db, insiderProfileId } = await setup();
    await grantPoints(db, insiderProfileId, 600);
    const deps = makeDeps(db);

    await expect(
      requestRedemption(deps, { idempotencyKey: "r4", insiderProfileId, points: 500, brand: "starbucks" })
    ).rejects.toThrow(UnknownBrandError);
    expect(await db.rewards.listRedemptions({ insiderProfileId })).toEqual([]);
  });

  it("propagates InsufficientPointsError from the db layer", async () => {
    const { db, insiderProfileId } = await setup();
    await grantPoints(db, insiderProfileId, 500);
    const deps = makeDeps(db);

    await expect(
      requestRedemption(deps, { idempotencyKey: "r5", insiderProfileId, points: 10000, brand: "amazon" })
    ).rejects.toThrow(InsufficientPointsError);
  });

  it("replaying the same idempotencyKey returns the same row and never calls the vendor twice or debits twice", async () => {
    const { db, insiderProfileId } = await setup();
    await grantPoints(db, insiderProfileId, 600);
    const fakeVendor = createFakeGiftCardVendor();
    const deps = makeDeps(db, fakeVendor.vendor);

    const first = await requestRedemption(deps, { idempotencyKey: "r6", insiderProfileId, points: 500, brand: "amazon" });
    const second = await requestRedemption(deps, { idempotencyKey: "r6", insiderProfileId, points: 500, brand: "amazon" });

    expect(second.id).toBe(first.id);
    expect(fakeVendor.issued).toHaveLength(1);
    const wallet = await db.rewards.getWallet(insiderProfileId);
    expect(wallet.balance).toBe(100);
  });

  it("a vendor failure leaves the redemption pending, logs the error, and does not throw", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, insiderProfileId } = await setup();
    await grantPoints(db, insiderProfileId, 600);
    const fakeVendor = createFakeGiftCardVendor();
    fakeVendor.setFailure(true);
    const deps = makeDeps(db, fakeVendor.vendor);

    const redemption = await requestRedemption(deps, { idempotencyKey: "r7", insiderProfileId, points: 500, brand: "amazon" });

    expect(redemption.status).toBe("pending");
    expect(consoleError).toHaveBeenCalled();
    const wallet = await db.rewards.getWallet(insiderProfileId);
    expect(wallet.pendingRedemptionPoints).toBe(500);
    consoleError.mockRestore();
  });

  it("a vendor issued result fulfils the redemption, moves escrow to platform, stamps vendorRef, and notifies exactly once", async () => {
    const { db, insiderProfileId } = await setup();
    await grantPoints(db, insiderProfileId, 600);
    const fakeVendor = createFakeGiftCardVendor();
    fakeVendor.setResult({ status: "issued", vendorRef: "gc-123" });
    const deps = makeDeps(db, fakeVendor.vendor);
    const { queue, notificationIds } = recordNotifySends(deps.queue);
    // Spies prove requestRedemption itself drove these calls exactly once — not that their
    // downstream side effects (a queued job, an escrow balance) merely happen to look right.
    const resolveSpy = vi.spyOn(db.rewards, "resolveRedemption");
    const insiderLookupSpy = vi.spyOn(db.identity, "getInsiderProfileById");
    const platformBefore = await db.ledger.getBalance("platform", "platform", "points");

    const redemption = await requestRedemption({ ...deps, queue }, { idempotencyKey: "r8", insiderProfileId, points: 500, brand: "amazon" });

    // Assertions on the value requestRedemption itself returned (not a re-fetched row). The fake
    // db mutates redemption rows in place, so status/vendorRef alone would read "fulfilled" even
    // if the implementation returned the pre-resolve object without ever resolving it; resolvedAt
    // and the resolveRedemption call count only become true once resolveRedemption actually ran.
    expect(redemption.status).toBe("fulfilled");
    expect(redemption.vendorRef).toBe("gc-123");
    expect(redemption.resolvedAt).not.toBeNull();
    expect(resolveSpy).toHaveBeenCalledTimes(1);

    // Escrow moved to platform (brief Step 1: "escrow moved to platform").
    expect(await db.ledger.getBalance("escrow", redemption.id, "points")).toBe(0);
    const platformAfter = await db.ledger.getBalance("platform", "platform", "points");
    expect(platformAfter - platformBefore).toBe(500);
    const wallet = await db.rewards.getWallet(insiderProfileId);
    expect(wallet.pendingRedemptionPoints).toBe(0);

    expect(notificationIds).toHaveLength(1);
    const notification = await db.notifications.getById(notificationIds[0]);
    expect(notification?.template).toBe("redemption.fulfilled");
    expect(insiderLookupSpy).toHaveBeenCalledTimes(1);

    const replay = await requestRedemption({ ...deps, queue }, { idempotencyKey: "r8", insiderProfileId, points: 500, brand: "amazon" });
    expect(replay.status).toBe("fulfilled");
    expect(fakeVendor.issued).toHaveLength(1);
    expect(resolveSpy).toHaveBeenCalledTimes(1);
    // Proves notifyInsiderOrLog itself was not invoked again on replay — not just that no second
    // job ended up queued, which notify()'s own eventKey dedupe would mask either way.
    expect(insiderLookupSpy).toHaveBeenCalledTimes(1);
    expect(notificationIds).toHaveLength(1);
  });

  it("throws RewardsNotConfiguredError when pointsPerCredit/paisePerPoint/giftCardBrands are missing, without creating a row or debiting", async () => {
    const { db, seedConfig, insiderProfileId } = await setup();
    seedConfig({ key: "rules", version: 4, placeholder: true, value: { ...BASE, paisePerPoint: undefined, giftCardBrands: undefined } });
    await grantPoints(db, insiderProfileId, 600);
    const deps = makeDeps(db);

    await expect(
      requestRedemption(deps, { idempotencyKey: "r9", insiderProfileId, points: 500, brand: "amazon" })
    ).rejects.toThrow(RewardsNotConfiguredError);
    expect(await db.rewards.listRedemptions({ insiderProfileId })).toEqual([]);
    const wallet = await db.rewards.getWallet(insiderProfileId);
    expect(wallet.balance).toBe(600);
  });
});

describe("notifyInsiderOrLog", () => {
  it("notifies the insider's user and swallows errors, including a missing profile", async () => {
    const { db, insiderProfileId } = await setup();
    const queue = createFakeQueueClient();
    const { queue: recordingQueue, notificationIds } = recordNotifySends(queue);

    await notifyInsiderOrLog({ db, queue: recordingQueue }, insiderProfileId, "redemption.fulfilled", { redemptionId: "x", brand: "amazon", points: 500 }, "evt1");
    expect(notificationIds).toHaveLength(1);

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      notifyInsiderOrLog({ db, queue: recordingQueue }, "missing-profile", "redemption.fulfilled", { redemptionId: "x", brand: "amazon", points: 500 }, "evt2")
    ).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
