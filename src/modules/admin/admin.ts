import type { Database, InsiderRequestRecord, VerificationProofRecord } from "../../adapters/db/types";
import type { QueueClient } from "../../jobs/queue";
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
  payload: unknown
): Promise<void> {
  try {
    await notify(deps, userId, template, payload);
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

  const updated = await deps.db.requests.applyTransition({
    idempotencyKey: `review:${input.requestId}:${input.idempotencyKey}`,
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
  });

  try {
    const insiderProfile = await deps.db.identity.getInsiderProfileById(record.insiderProfileId);
    const insiderSummary = await deps.db.insiders.getInsiderById(record.insiderProfileId);
    const seekerProfile = await deps.db.identity.getSeekerProfileById(record.seekerProfileId);

    if (input.decision === "verify") {
      if (insiderProfile && insiderSummary && seekerProfile) {
        await notifyOrLog(deps, insiderProfile.userId, "proof.verified", {
          requestId: input.requestId,
          companyName: insiderSummary.companyName,
          audience: "insider",
          seekerName: seekerProfile.fullName,
        });
        await notifyOrLog(deps, seekerProfile.userId, "proof.verified", {
          requestId: input.requestId,
          companyName: insiderSummary.companyName,
          audience: "seeker",
        });
      }
    } else if (insiderProfile && seekerProfile) {
      await notifyOrLog(deps, insiderProfile.userId, "proof.rejected", {
        requestId: input.requestId,
        seekerName: seekerProfile.fullName,
        reason: input.reason ?? "",
      });
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
