// @vitest-environment node
// Live test against a real Postgres (dev compose). Skipped unless RUN_VENDOR_TESTS=1.
// Run: export $(grep -v '^#' .env.local | grep -v '^$' | xargs -d '\n'); npm run db:migrate; npm run db:seed;
//      RUN_VENDOR_TESTS=1 npx vitest run src/modules/rewards/rewards.live.test.ts
//
// This exercises the real adapter's rewards SQL directly through db.requests/db.rewards/db.ledger
// (not the rewards/admin modules), so it proves the real locking, idempotency and overspend-race
// behaviour that fakes cannot — a real-adapter bug here (e.g. a bad lock order or a missing
// idempotency check) must fail this test, never be worked around by loosening an assertion.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { createRealDatabase } from "../../adapters/db/real";
import {
  InsufficientPointsError,
  RedemptionAlreadyResolvedError,
  RequestStateConflictError,
  type Database,
} from "../../adapters/db/types";

const live = process.env.RUN_VENDOR_TESTS === "1";

describe.skipIf(!live)("rewards against real Postgres", () => {
  const tag = Date.now().toString(36);
  let pool: Pool;
  let db: Database;
  let companyId: string;
  let seekerCounter = 0;
  let insiderCounter = 0;
  let requestCounter = 0;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = createRealDatabase(drizzle(pool));
    const { rows } = await pool.query<{ id: string }>("select id from companies limit 1");
    if (rows.length === 0) throw new Error("No seeded companies found — run `npm run db:seed` first");
    companyId = rows[0].id;
  });

  afterAll(async () => {
    await pool.end();
  });

  async function createSeekerProfile(): Promise<string> {
    seekerCounter++;
    const user = await db.identity.findOrCreateUser(`fb-live-${tag}-s${seekerCounter}`, `s-${tag}-${seekerCounter}@x.com`, "seeker");
    const profile = await db.identity.createSeekerProfile(user.id, `Live Seeker ${seekerCounter}`);
    await db.ledger.postTxn({
      idempotencyKey: `live:${tag}:credits:${profile.id}`,
      eventType: "credits.grant",
      entries: [
        { ownerType: "platform", ownerId: "platform", currency: "credits", amount: -1000 },
        { ownerType: "seeker", ownerId: profile.id, currency: "credits", amount: 1000 },
      ],
    });
    return profile.id;
  }

  async function createInsiderProfile(): Promise<string> {
    insiderCounter++;
    const email = `i-${tag}-${insiderCounter}@acme-live.com`;
    const user = await db.identity.findOrCreateUser(`fb-live-${tag}-i${insiderCounter}`, email, "seeker");
    const profile = await db.identity.findOrCreateInsiderProfile(user.id, companyId, email);
    await db.identity.markInsiderVerified(profile.id, new Date());
    return profile.id;
  }

  async function createAdminUser(): Promise<string> {
    const user = await db.identity.findOrCreateUser(`fb-live-${tag}-admin`, `admin-${tag}@x.com`, "admin");
    return user.id;
  }

  async function makeRequest(seekerProfileId: string, insiderProfileId: string, creditCost = 3) {
    requestCounter++;
    return db.requests.sendRequest({
      idempotencyKey: `live:${tag}:send:${requestCounter}`,
      seekerProfileId,
      insiderProfileId,
      companyId,
      creditCost,
      rulesVersion: 1,
    });
  }

  async function grantPoints(insiderProfileId: string, amount: number): Promise<void> {
    await db.ledger.postTxn({
      idempotencyKey: `live:${tag}:grant-points:${insiderProfileId}:${amount}:${Math.random()}`,
      eventType: "points.grant",
      entries: [
        { ownerType: "platform", ownerId: "platform", currency: "points", amount: -amount },
        { ownerType: "insider", ownerId: insiderProfileId, currency: "points", amount },
      ],
    });
  }

  it("releaseTranche posts a zero-sum points txn and is idempotent per (requestId, tranche); a second tranche adds", async () => {
    const seekerProfileId = await createSeekerProfile();
    const insiderProfileId = await createInsiderProfile();
    const request = await makeRequest(seekerProfileId, insiderProfileId);

    const first = await db.rewards.releaseTranche({ requestId: request.id, insiderProfileId, tranche: 1, points: 60 });
    expect(first.points).toBe(60);
    expect(await db.ledger.getBalance("insider", insiderProfileId, "points")).toBe(60);
    expect(await db.ledger.getBalance("platform", "platform", "points")).toBeLessThanOrEqual(0);

    // Same (requestId, tranche) again: idempotent, no double-credit.
    const replay = await db.rewards.releaseTranche({ requestId: request.id, insiderProfileId, tranche: 1, points: 60 });
    expect(replay.id).toBe(first.id);
    expect(await db.ledger.getBalance("insider", insiderProfileId, "points")).toBe(60);

    // Tranche 2 on the same request adds on top.
    const second = await db.rewards.releaseTranche({ requestId: request.id, insiderProfileId, tranche: 2, points: 40 });
    expect(second.id).not.toBe(first.id);
    expect(await db.ledger.getBalance("insider", insiderProfileId, "points")).toBe(100);
  });

  it("applyTransition with trancheRelease moves state and releases points in one shot; replaying the transition key does not release twice", async () => {
    const seekerProfileId = await createSeekerProfile();
    const insiderProfileId = await createInsiderProfile();
    const request = await makeRequest(seekerProfileId, insiderProfileId);

    await db.requests.applyTransition({
      idempotencyKey: `live:${tag}:${request.id}:accept`,
      requestId: request.id,
      event: "accept",
      fromState: "SENT",
      toState: "ACCEPTED",
      ledgerEntries: [],
      ledgerEventType: "request.accept",
    });
    await db.requests.submitProof({
      idempotencyKey: `live:${tag}:${request.id}:proof`,
      requestId: request.id,
      fromState: "ACCEPTED",
      toState: "PROOF_PENDING",
      proofType: "text",
      textContent: "submitted internally",
    });

    const verifyKey = `live:${tag}:${request.id}:verify`;
    const verified = await db.requests.applyTransition({
      idempotencyKey: verifyKey,
      requestId: request.id,
      event: "verify",
      fromState: "PROOF_PENDING",
      toState: "SUBMITTED",
      ledgerEntries: [],
      ledgerEventType: "request.verify",
      trancheRelease: { insiderProfileId, tranche: 1, points: 60 },
    });
    expect(verified.state).toBe("SUBMITTED");
    const rewards = await db.rewards.listRewards(insiderProfileId);
    expect(rewards).toHaveLength(1);
    expect(rewards[0].requestId).toBe(request.id);
    expect(await db.ledger.getBalance("insider", insiderProfileId, "points")).toBe(60);

    // Replay of the exact same transition key: returns the current row, no second reward.
    const replay = await db.requests.applyTransition({
      idempotencyKey: verifyKey,
      requestId: request.id,
      event: "verify",
      fromState: "PROOF_PENDING",
      toState: "SUBMITTED",
      ledgerEntries: [],
      ledgerEventType: "request.verify",
      trancheRelease: { insiderProfileId, tranche: 1, points: 60 },
    });
    expect(replay.state).toBe("SUBMITTED");
    expect(await db.rewards.listRewards(insiderProfileId)).toHaveLength(1);
    expect(await db.ledger.getBalance("insider", insiderProfileId, "points")).toBe(60);
  });

  it("applyTransition atomicity: a zero-point trancheRelease releases nothing; an invalid fromState throws and leaves no reward or balance change", async () => {
    const seekerProfileId = await createSeekerProfile();
    const insiderProfileId = await createInsiderProfile();
    const request = await makeRequest(seekerProfileId, insiderProfileId);

    const afterAccept = await db.requests.applyTransition({
      idempotencyKey: `live:${tag}:${request.id}:accept-zero`,
      requestId: request.id,
      event: "accept",
      fromState: "SENT",
      toState: "ACCEPTED",
      ledgerEntries: [],
      ledgerEventType: "request.accept",
      trancheRelease: { insiderProfileId, tranche: 1, points: 0 },
    });
    expect(afterAccept.state).toBe("ACCEPTED");
    expect(await db.rewards.listRewards(insiderProfileId)).toEqual([]);
    expect(await db.ledger.getBalance("insider", insiderProfileId, "points")).toBe(0);

    await expect(
      db.requests.applyTransition({
        idempotencyKey: `live:${tag}:${request.id}:verify-badstate`,
        requestId: request.id,
        event: "verify",
        fromState: "SENT", // actual current state is ACCEPTED
        toState: "SUBMITTED",
        ledgerEntries: [],
        ledgerEventType: "request.verify",
        trancheRelease: { insiderProfileId, tranche: 1, points: 60 },
      })
    ).rejects.toThrow(RequestStateConflictError);

    expect(await db.rewards.listRewards(insiderProfileId)).toEqual([]);
    expect(await db.ledger.getBalance("insider", insiderProfileId, "points")).toBe(0);
    const current = await db.requests.getById(request.id);
    expect(current?.state).toBe("ACCEPTED");
  });

  it("createRedemption debits into escrow, replays the same key as a no-op, and rejects overspend", async () => {
    const insiderProfileId = await createInsiderProfile();
    await grantPoints(insiderProfileId, 200);

    const key = `live:${tag}:${insiderProfileId}:redeem`;
    const { redemption, created } = await db.rewards.createRedemption({
      idempotencyKey: key,
      insiderProfileId,
      points: 150,
      brand: "amazon",
      denominationPaise: 15000,
      vendor: "manual",
    });
    expect(created).toBe(true);
    expect(redemption.status).toBe("pending");
    expect(await db.ledger.getBalance("insider", insiderProfileId, "points")).toBe(50);
    expect(await db.ledger.getBalance("escrow", redemption.id, "points")).toBe(150);

    const replay = await db.rewards.createRedemption({
      idempotencyKey: key,
      insiderProfileId,
      points: 150,
      brand: "amazon",
      denominationPaise: 15000,
      vendor: "manual",
    });
    expect(replay.created).toBe(false);
    expect(replay.redemption.id).toBe(redemption.id);
    expect(await db.ledger.getBalance("insider", insiderProfileId, "points")).toBe(50);

    await expect(
      db.rewards.createRedemption({
        idempotencyKey: `live:${tag}:${insiderProfileId}:redeem-overspend`,
        insiderProfileId,
        points: 999,
        brand: "amazon",
        denominationPaise: 99900,
        vendor: "manual",
      })
    ).rejects.toThrow(InsufficientPointsError);
    expect(await db.ledger.getBalance("insider", insiderProfileId, "points")).toBe(50);
  });

  it("overspend race: two concurrent createRedemption calls for more than the balance settle to exactly one winner", async () => {
    const insiderProfileId = await createInsiderProfile();
    await grantPoints(insiderProfileId, 100);

    const [r1, r2] = await Promise.allSettled([
      db.rewards.createRedemption({
        idempotencyKey: `live:${tag}:${insiderProfileId}:race-a`,
        insiderProfileId,
        points: 60,
        brand: "amazon",
        denominationPaise: 6000,
        vendor: "manual",
      }),
      db.rewards.createRedemption({
        idempotencyKey: `live:${tag}:${insiderProfileId}:race-b`,
        insiderProfileId,
        points: 60,
        brand: "amazon",
        denominationPaise: 6000,
        vendor: "manual",
      }),
    ]);

    const outcomes = [r1, r2];
    const fulfilled = outcomes.filter((o): o is PromiseFulfilledResult<Awaited<ReturnType<typeof db.rewards.createRedemption>>> => o.status === "fulfilled");
    const rejected = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(InsufficientPointsError);

    expect(await db.ledger.getBalance("insider", insiderProfileId, "points")).toBe(40);

    const { rows } = await pool.query<{ count: number }>(
      `select count(*)::int as count
       from ledger_txns t
       join ledger_entries e on e.txn_id = t.id
       join ledger_accounts a on a.id = e.account_id
       where t.event_type = 'reward.redemption.hold'
         and a.owner_type = 'insider'
         and a.owner_id = $1`,
      [insiderProfileId]
    );
    expect(rows[0].count).toBe(1);
  });

  it("resolveRedemption: fulfilled moves escrow to platform and audits; rejected restores the balance; replay of the same outcome is a no-op; the opposite outcome after resolution throws", async () => {
    const insiderProfileId = await createInsiderProfile();
    const adminUserId = await createAdminUser();
    await grantPoints(insiderProfileId, 300);

    const { redemption: toFulfil } = await db.rewards.createRedemption({
      idempotencyKey: `live:${tag}:${insiderProfileId}:resolve-fulfil`,
      insiderProfileId,
      points: 100,
      brand: "amazon",
      denominationPaise: 10000,
      vendor: "manual",
    });
    const platformBefore = await db.ledger.getBalance("platform", "platform", "points");

    const fulfilled = await db.rewards.resolveRedemption({
      redemptionId: toFulfil.id,
      outcome: "fulfilled",
      vendorRef: "gc-live-1",
      adminAudit: {
        adminUserId,
        action: "redemption.fulfil",
        targetType: "reward_redemption",
        targetId: toFulfil.id,
        detail: "live test",
      },
    });
    expect(fulfilled.status).toBe("fulfilled");
    expect(fulfilled.vendorRef).toBe("gc-live-1");
    expect(fulfilled.resolvedAt).not.toBeNull();
    expect(await db.ledger.getBalance("escrow", toFulfil.id, "points")).toBe(0);
    expect((await db.ledger.getBalance("platform", "platform", "points")) - platformBefore).toBe(100);

    const auditRows = await db.requests.listAuditLogByTarget("reward_redemption", toFulfil.id);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].action).toBe("redemption.fulfil");
    expect(auditRows[0].adminUserId).toBe(adminUserId);

    // Replaying the same outcome is a no-op.
    const replayFulfilled = await db.rewards.resolveRedemption({ redemptionId: toFulfil.id, outcome: "fulfilled" });
    expect(replayFulfilled.status).toBe("fulfilled");
    expect(await db.ledger.getBalance("platform", "platform", "points")).toBe(platformBefore + 100);

    // The opposite outcome after resolution throws.
    await expect(
      db.rewards.resolveRedemption({ redemptionId: toFulfil.id, outcome: "rejected", rejectReason: "changed mind" })
    ).rejects.toThrow(RedemptionAlreadyResolvedError);

    // Rejected path, on a fresh redemption: balance is restored.
    const { redemption: toReject } = await db.rewards.createRedemption({
      idempotencyKey: `live:${tag}:${insiderProfileId}:resolve-reject`,
      insiderProfileId,
      points: 50,
      brand: "amazon",
      denominationPaise: 5000,
      vendor: "manual",
    });
    const balanceBeforeReject = await db.ledger.getBalance("insider", insiderProfileId, "points");
    const rejected = await db.rewards.resolveRedemption({
      redemptionId: toReject.id,
      outcome: "rejected",
      rejectReason: "not eligible",
    });
    expect(rejected.status).toBe("rejected");
    expect(rejected.rejectReason).toBe("not eligible");
    expect(await db.ledger.getBalance("insider", insiderProfileId, "points")).toBe(balanceBeforeReject + 50);
    expect(await db.ledger.getBalance("escrow", toReject.id, "points")).toBe(0);

    const replayRejected = await db.rewards.resolveRedemption({ redemptionId: toReject.id, outcome: "rejected" });
    expect(replayRejected.status).toBe("rejected");
    expect(await db.ledger.getBalance("insider", insiderProfileId, "points")).toBe(balanceBeforeReject + 50);
  });

  it("getWallet reports balance, lifetimeEarned and pendingRedemptionPoints; listRedemptions filters by status", async () => {
    const seekerProfileId = await createSeekerProfile();
    const insiderProfileId = await createInsiderProfile();
    const request = await makeRequest(seekerProfileId, insiderProfileId);

    await db.rewards.releaseTranche({ requestId: request.id, insiderProfileId, tranche: 1, points: 80 });
    await grantPoints(insiderProfileId, 20); // Not a tranche release: adds to balance, not to lifetimeEarned.

    const { redemption } = await db.rewards.createRedemption({
      idempotencyKey: `live:${tag}:${insiderProfileId}:wallet-redeem`,
      insiderProfileId,
      points: 50,
      brand: "amazon",
      denominationPaise: 5000,
      vendor: "manual",
    });

    const wallet = await db.rewards.getWallet(insiderProfileId);
    expect(wallet.balance).toBe(50); // 80 + 20 - 50
    expect(wallet.lifetimeEarned).toBe(80); // only insider_rewards rows count
    expect(wallet.pendingRedemptionPoints).toBe(50);

    const pendingBefore = await db.rewards.listRedemptions({ insiderProfileId, status: "pending" });
    expect(pendingBefore.map((r) => r.id)).toContain(redemption.id);

    await db.rewards.resolveRedemption({ redemptionId: redemption.id, outcome: "fulfilled" });

    const fulfilledList = await db.rewards.listRedemptions({ insiderProfileId, status: "fulfilled" });
    expect(fulfilledList.map((r) => r.id)).toContain(redemption.id);
    const pendingAfter = await db.rewards.listRedemptions({ insiderProfileId, status: "pending" });
    expect(pendingAfter.map((r) => r.id)).not.toContain(redemption.id);
  });

  it("ledger invariant: every tranche-release and redemption ledger transaction is zero-sum for points", async () => {
    const { rows } = await pool.query<{ id: string; idempotency_key: string; total: number }>(`
      select t.id, t.idempotency_key, sum(e.amount)::int as total
      from ledger_txns t
      join ledger_entries e on e.txn_id = t.id
      where t.idempotency_key like 'request:%:tranche:%' or t.idempotency_key like 'redemption:%'
      group by t.id, t.idempotency_key
      having sum(e.amount) <> 0
    `);
    expect(rows).toEqual([]);
  });
});
