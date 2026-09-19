import type { Database, InsiderRequestRecord, VerificationProofRecord } from "../../adapters/db/types";
import { nextState, type RequestState } from "../requests/state";

export interface AdminDeps {
  db: Database;
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

export async function reviewProof(deps: AdminDeps, input: ReviewProofInput): Promise<InsiderRequestRecord> {
  if (input.decision === "reject" && !input.reason) {
    throw new MissingRejectionReasonError();
  }

  const record = await deps.db.requests.getById(input.requestId);
  if (!record) throw new Error(`Insider request ${input.requestId} not found`);

  const event = input.decision === "verify" ? "verify" : "reject";
  const toState = nextState(record.state as RequestState, event);

  return deps.db.requests.applyTransition({
    idempotencyKey: `review:${input.idempotencyKey}`,
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
