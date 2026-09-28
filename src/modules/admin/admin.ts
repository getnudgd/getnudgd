import type { Database, InsiderRequestRecord, RewardRedemptionRecord, RedemptionStatus, VerificationProofRecord } from "../../adapters/db/types";
import type { QueueClient } from "../../jobs/queue";
import { getRulesWithVersion } from "../config/config";
import { computeTranchePoints } from "../rewards/points";
import { notifyInsiderOrLog } from "../rewards/rewards";
import { nextState, type RequestState } from "../requests/state";
import { notify } from "../notifications/notifications";

export interface AdminDeps {
  db: Database;
  queue: QueueClient;
}

export class MissingRejectionReasonError extends Error {
  constructor() {
    super("A reason is required when rejecting a proof");
    this.name = "MissingRejectionReasonError";
  }
}

export class MissingVendorRefError extends Error {
  constructor() {
    super("A vendor reference is required to fulfil a redemption");
    this.name = "MissingVendorRefError";
  }
}

export class MissingRedemptionReasonError extends Error {
  constructor() {
    super("A reason is required when rejecting a redemption");
    this.name = "MissingRedemptionReasonError";
  }
}

export type ProofReviewDecision = "verify" | "reject";

export interface ReviewProofInput {
  idempotencyKey: string;
  adminUserId: string;
  requestId: string;
  decision: ProofReviewDecision;
  reason?: string;
}

async function notifyOrLog(
  deps: AdminDeps,
  userId: string,
  template: Parameters<typeof notify>[2],
  payload: unknown,
  eventKey: string
): Promise<void> {
  try {
    await notify(deps, userId, template, payload, eventKey);
  } catch (err) {
    console.error(`[admin] failed to send ${template} notification to user ${userId}`, err);
  }
}

export async function reviewProof(deps: AdminDeps, input: ReviewProofInput): Promise<InsiderRequestRecord> {
  if (input.decision === "reject" && !input.reason) {
    throw new MissingRejectionReasonError();
  }

  const record = await deps.db.requests.getById(input.requestId);
  if (!record) throw new Error(`Insider request ${input.requestId} not found`);

  const event = input.decision === "verify" ? "verify" : "reject";
  const toState = nextState(record.state as RequestState, event);

  const transitionKey = `review:${input.requestId}:${input.idempotencyKey}`;

  // Compute (and validate) the tranche-1 payout BEFORE applyTransition runs, so
  // a RewardsNotConfiguredError/ConfigNotFoundError here throws before any
  // state change — a proof must never verify without its points being resolved.
  let tranche1Points = 0;
  if (input.decision === "verify") {
    const { rules } = await getRulesWithVersion(deps, record.rulesVersion);
    tranche1Points = computeTranchePoints(rules, record.creditCost, 1);
  }

  const updated = await deps.db.requests.applyTransition({
    idempotencyKey: transitionKey,
    requestId: input.requestId,
    event,
    fromState: record.state,
    toState,
    ledgerEntries: [],
    ledgerEventType: `request.${event}`,
    adminAudit: {
      adminUserId: input.adminUserId,
      action: `proof.${event}`,
      targetType: "insider_request",
      targetId: input.requestId,
      detail: input.reason,
    },
    trancheRelease:
      tranche1Points > 0 ? { insiderProfileId: record.insiderProfileId, tranche: 1, points: tranche1Points } : undefined,
  });

  try {
    const insiderProfile = await deps.db.identity.getInsiderProfileById(record.insiderProfileId);
    const insiderSummary = await deps.db.insiders.getInsiderById(record.insiderProfileId);
    const seekerProfile = await deps.db.identity.getSeekerProfileById(record.seekerProfileId);

    if (input.decision === "verify") {
      if (insiderProfile && insiderSummary && seekerProfile) {
        await notifyOrLog(
          deps,
          insiderProfile.userId,
          "proof.verified",
          {
            requestId: input.requestId,
            companyName: insiderSummary.companyName,
            audience: "insider",
            seekerName: seekerProfile.fullName,
          },
          transitionKey
        );
        await notifyOrLog(
          deps,
          seekerProfile.userId,
          "proof.verified",
          {
            requestId: input.requestId,
            companyName: insiderSummary.companyName,
            audience: "seeker",
          },
          transitionKey
        );
        if (tranche1Points > 0) {
          await notifyOrLog(
            deps,
            insiderProfile.userId,
            "reward.released",
            {
              requestId: input.requestId,
              tranche: 1,
              points: tranche1Points,
              companyName: insiderSummary.companyName,
            },
            transitionKey
          );
        }
      }
    } else if (insiderProfile && seekerProfile) {
      await notifyOrLog(
        deps,
        insiderProfile.userId,
        "proof.rejected",
        {
          requestId: input.requestId,
          seekerName: seekerProfile.fullName,
          reason: input.reason ?? "",
        },
        transitionKey
      );
    }
  } catch (err) {
    console.error(`[admin] failed to load notification recipients for request ${input.requestId}`, err);
  }

  return updated;
}

export interface PendingProof {
  request: InsiderRequestRecord;
  proof: VerificationProofRecord | null;
}

export async function listPendingProofs(deps: AdminDeps): Promise<PendingProof[]> {
  const pending = await deps.db.requests.listByState("PROOF_PENDING");
  return Promise.all(
    pending.map(async (request) => ({
      request,
      proof: await deps.db.requests.getProofByRequestId(request.id),
    }))
  );
}

export async function listRewardRedemptions(
  deps: { db: Database },
  status?: RedemptionStatus
): Promise<RewardRedemptionRecord[]> {
  return deps.db.rewards.listRedemptions(status ? { status } : undefined);
}

export interface FulfilRedemptionInput {
  adminUserId: string;
  redemptionId: string;
  vendorRef: string;
}

export async function fulfilRedemption(deps: AdminDeps, input: FulfilRedemptionInput): Promise<RewardRedemptionRecord> {
  const vendorRef = input.vendorRef.trim();
  if (!vendorRef) throw new MissingVendorRefError();

  const redemption = await deps.db.rewards.resolveRedemption({
    redemptionId: input.redemptionId,
    outcome: "fulfilled",
    vendorRef,
    adminAudit: {
      adminUserId: input.adminUserId,
      action: "redemption.fulfil",
      targetType: "reward_redemption",
      targetId: input.redemptionId,
      detail: vendorRef,
    },
  });

  await notifyInsiderOrLog(
    deps,
    redemption.insiderProfileId,
    "redemption.fulfilled",
    { redemptionId: input.redemptionId, brand: redemption.brand, points: redemption.points },
    `redemption:${input.redemptionId}:fulfilled`
  );

  return redemption;
}

export interface RejectRedemptionInput {
  adminUserId: string;
  redemptionId: string;
  reason: string;
}

export async function rejectRedemption(deps: AdminDeps, input: RejectRedemptionInput): Promise<RewardRedemptionRecord> {
  const reason = input.reason.trim();
  if (!reason) throw new MissingRedemptionReasonError();

  const redemption = await deps.db.rewards.resolveRedemption({
    redemptionId: input.redemptionId,
    outcome: "rejected",
    rejectReason: reason,
    adminAudit: {
      adminUserId: input.adminUserId,
      action: "redemption.reject",
      targetType: "reward_redemption",
      targetId: input.redemptionId,
      detail: reason,
    },
  });

  await notifyInsiderOrLog(
    deps,
    redemption.insiderProfileId,
    "redemption.rejected",
    { redemptionId: input.redemptionId, points: redemption.points, reason },
    `redemption:${input.redemptionId}:rejected`
  );

  return redemption;
}
