import type { Database, InsiderRewardRecord, RewardRedemptionRecord, WalletSummary } from "../../adapters/db/types";
import type { QueueClient } from "../../jobs/queue";
import type { GiftCardVendor } from "../../adapters/giftcards/types";
import type { TemplateName } from "../notifications/templates";
import { notify } from "../notifications/notifications";
import { getRulesWithVersion } from "../config/config";
import { computeTranchePoints, requireRewardsConfig } from "./points";

export interface RewardsDeps {
  db: Database;
  queue: QueueClient;
  giftCards: GiftCardVendor;
}

export class BelowMinimumRedemptionError extends Error {
  constructor(points: number, minimum: number) {
    super(`Redemption of ${points} points is below the minimum of ${minimum} points`);
    this.name = "BelowMinimumRedemptionError";
  }
}

export class UnknownBrandError extends Error {
  constructor(brand: string) {
    super(`"${brand}" is not a configured gift-card brand`);
    this.name = "UnknownBrandError";
  }
}

// Swallows any failure (including a missing insider profile) so that a
// notification problem never blocks the money-moving operation that
// triggered it. Callers that must notify as part of a critical path use
// this instead of calling notify() directly.
export async function notifyInsiderOrLog(
  deps: { db: Database; queue: QueueClient },
  insiderProfileId: string,
  template: TemplateName,
  payload: unknown,
  eventKey: string
): Promise<void> {
  try {
    const profile = await deps.db.identity.getInsiderProfileById(insiderProfileId);
    if (!profile) throw new Error(`Insider profile ${insiderProfileId} not found`);
    await notify(deps, profile.userId, template, payload, eventKey);
  } catch (err) {
    console.error(`[rewards] failed to send ${template} notification to insider ${insiderProfileId}`, err);
  }
}

// Releases one tranche of Insider Rewards points for a request, computed
// under the rules_version the request was stamped with at send time — never
// the latest rules — so a mid-flight config change cannot change what an
// in-flight request pays. Does NOT notify: tranche 1 is notified by
// admin.reviewProof and tranche 2's caller (interview confirmation) notifies
// itself, since each has richer context (company name, audience) than this
// module has access to.
export async function releaseTranche(
  deps: RewardsDeps,
  input: { requestId: string; tranche: 1 | 2 }
): Promise<InsiderRewardRecord | null> {
  const request = await deps.db.requests.getById(input.requestId);
  if (!request) throw new Error(`Insider request ${input.requestId} not found`);

  const { rules } = await getRulesWithVersion(deps, request.rulesVersion);
  const points = computeTranchePoints(rules, request.creditCost, input.tranche);
  if (points === 0) return null;

  return deps.db.rewards.releaseTranche({
    requestId: input.requestId,
    insiderProfileId: request.insiderProfileId,
    tranche: input.tranche,
    points,
  });
}

export async function getWallet(deps: { db: Database }, insiderProfileId: string): Promise<WalletSummary> {
  return deps.db.rewards.getWallet(insiderProfileId);
}

export async function listRewards(deps: { db: Database }, insiderProfileId: string): Promise<InsiderRewardRecord[]> {
  return deps.db.rewards.listRewards(insiderProfileId);
}

export async function listRedemptions(deps: { db: Database }, insiderProfileId: string): Promise<RewardRedemptionRecord[]> {
  return deps.db.rewards.listRedemptions({ insiderProfileId });
}

export interface RequestRedemptionInput {
  idempotencyKey: string;
  insiderProfileId: string;
  points: number;
  brand: string;
}

export async function requestRedemption(deps: RewardsDeps, input: RequestRedemptionInput): Promise<RewardRedemptionRecord> {
  const rules = await getRulesWithVersion(deps).then((r) => r.rules);
  const { paisePerPoint, giftCardBrands } = requireRewardsConfig(rules);

  if (!Number.isInteger(input.points) || input.points <= 0 || input.points < rules.minRedemptionPoints) {
    throw new BelowMinimumRedemptionError(input.points, rules.minRedemptionPoints);
  }
  if (!giftCardBrands.includes(input.brand)) {
    throw new UnknownBrandError(input.brand);
  }

  const denominationPaise = input.points * paisePerPoint;

  // createRedemption is the idempotency boundary: it debits the insider's
  // wallet into escrow exactly once per idempotencyKey. `created: false`
  // means this call is a replay of a request already recorded — the vendor
  // must never be called again for it, whatever happened on the first call
  // (still pending, or already resolved).
  const { redemption, created } = await deps.db.rewards.createRedemption({
    idempotencyKey: `redemption:${input.insiderProfileId}:${input.idempotencyKey}`,
    insiderProfileId: input.insiderProfileId,
    points: input.points,
    brand: input.brand,
    denominationPaise,
    vendor: deps.giftCards.name,
  });
  if (!created) return redemption;

  let result;
  try {
    result = await deps.giftCards.issue({
      redemptionId: redemption.id,
      brand: input.brand,
      denominationPaise,
    });
  } catch (err) {
    // The redemption stays `pending` — visible to admin for manual follow-up —
    // and this must never throw out of requestRedemption: the points are
    // already safely held in escrow regardless of vendor availability.
    console.error(`[rewards] gift-card vendor "${deps.giftCards.name}" failed to issue redemption ${redemption.id}`, err);
    return redemption;
  }

  if (result.status === "pending") return redemption;

  const resolved = await deps.db.rewards.resolveRedemption({
    redemptionId: redemption.id,
    outcome: "fulfilled",
    vendorRef: result.vendorRef ?? undefined,
  });

  await notifyInsiderOrLog(
    deps,
    input.insiderProfileId,
    "redemption.fulfilled",
    { redemptionId: redemption.id, brand: input.brand, points: input.points },
    `redemption:${redemption.id}:fulfilled`
  );

  return resolved;
}
