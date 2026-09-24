import type { Database, InsiderRequestRecord, PostLedgerEntryInput } from "../../adapters/db/types";
import { RequestStateConflictError } from "../../adapters/db/types";
import { getRulesWithVersion } from "../config/config";
import { UnknownCompanyTierError } from "../insiders/insiders";
import { escrowFor, platformAccount } from "../ledger/ledger";
import type { QueueClient } from "../../jobs/queue";
import { notify } from "../notifications/notifications";
import { nextState, type RequestState } from "./state";

export interface RequestsDeps {
  db: Database;
  queue: QueueClient;
}

export class InsiderUnavailableError extends Error {
  constructor(insiderProfileId: string) {
    super(`Insider ${insiderProfileId} is not available to receive requests (not verified or not available)`);
    this.name = "InsiderUnavailableError";
  }
}

export class MissingProofContentError extends Error {
  constructor(proofType: "screenshot" | "text") {
    super(`A ${proofType === "screenshot" ? "file" : "text"} is required to submit ${proofType} proof`);
    this.name = "MissingProofContentError";
  }
}

export interface SendRequestInput {
  idempotencyKey: string;
  seekerProfileId: string;
  insiderProfileId: string;
}

export async function sendRequest(deps: RequestsDeps, input: SendRequestInput): Promise<InsiderRequestRecord> {
  const profile = await deps.db.identity.getInsiderProfileById(input.insiderProfileId);
  if (!profile || profile.verifiedAt === null || !profile.available) {
    throw new InsiderUnavailableError(input.insiderProfileId);
  }

  const summary = await deps.db.insiders.getInsiderById(input.insiderProfileId);
  if (!summary) throw new InsiderUnavailableError(input.insiderProfileId);

  const { rules, version: rulesVersion } = await getRulesWithVersion(deps);
  const creditCost = rules.requestCostByTier[summary.companyTier];
  if (creditCost === undefined) throw new UnknownCompanyTierError(summary.companyTier);

  const request = await deps.db.requests.sendRequest({
    idempotencyKey: `send:${input.idempotencyKey}`,
    seekerProfileId: input.seekerProfileId,
    insiderProfileId: input.insiderProfileId,
    companyId: profile.companyId,
    creditCost,
    rulesVersion,
  });

  try {
    await deps.queue.send(
      "request.expire",
      { requestId: request.id },
      { singletonKey: `request:${request.id}:expire`, startAfterSeconds: rules.responseWindowHours * 3600 }
    );
  } catch (err) {
    // The DB transaction above (debit + escrow + request row) already
    // committed — the seeker's credits are already spent. Do not fail the
    // whole call over a lost timer enqueue; the hourly requests.sweep job is
    // the designed compensating control for exactly this case.
    console.error(`[requests] failed to enqueue request.expire for request ${request.id}`, err);
  }

  return request;
}

function refundEntries(
  requestId: string,
  seekerProfileId: string,
  creditCost: number,
  refundPercent: number
): PostLedgerEntryInput[] {
  const refundAmount = Math.round((creditCost * refundPercent) / 100);
  const forfeitAmount = creditCost - refundAmount;
  const entries: PostLedgerEntryInput[] = [
    { ...escrowFor(requestId), currency: "credits", amount: -creditCost },
  ];
  if (refundAmount > 0) {
    entries.push({ ownerType: "seeker", ownerId: seekerProfileId, currency: "credits", amount: refundAmount });
  }
  if (forfeitAmount > 0) {
    entries.push({ ...platformAccount(), currency: "credits", amount: forfeitAmount });
  }
  return entries;
}

export async function accept(deps: RequestsDeps, requestId: string): Promise<InsiderRequestRecord> {
  const record = await deps.db.requests.getById(requestId);
  if (!record) throw new Error(`Insider request ${requestId} not found`);
  const toState = nextState(record.state as RequestState, "accept");

  const updated = await deps.db.requests.applyTransition({
    idempotencyKey: `request:${requestId}:accept`,
    requestId,
    event: "accept",
    fromState: record.state,
    toState,
    ledgerEntries: [],
    ledgerEventType: "request.accept",
  });

  try {
    const seekerProfile = await deps.db.identity.getSeekerProfileById(record.seekerProfileId);
    const insiderSummary = await deps.db.insiders.getInsiderById(record.insiderProfileId);
    if (seekerProfile && insiderSummary) {
      await notify(
        deps,
        seekerProfile.userId,
        "request.accepted",
        {
          requestId,
          companyName: insiderSummary.companyName,
        },
        `request:${requestId}:accept`
      );
    }
  } catch (err) {
    console.error(`[requests] failed to notify on accept for request ${requestId}`, err);
  }

  return updated;
}

export async function decline(deps: RequestsDeps, requestId: string): Promise<InsiderRequestRecord> {
  const record = await deps.db.requests.getById(requestId);
  if (!record) throw new Error(`Insider request ${requestId} not found`);
  const toState = nextState(record.state as RequestState, "decline");
  const { rules } = await getRulesWithVersion(deps, record.rulesVersion);
  const entries = refundEntries(requestId, record.seekerProfileId, record.creditCost, rules.refundPercentOnDecline);

  const updated = await deps.db.requests.applyTransition({
    idempotencyKey: `request:${requestId}:decline`,
    requestId,
    event: "decline",
    fromState: record.state,
    toState,
    ledgerEntries: entries,
    ledgerEventType: "request.decline",
  });

  try {
    const seekerProfile = await deps.db.identity.getSeekerProfileById(record.seekerProfileId);
    const insiderSummary = await deps.db.insiders.getInsiderById(record.insiderProfileId);
    if (seekerProfile && insiderSummary) {
      const refundedCredits = Math.round((record.creditCost * rules.refundPercentOnDecline) / 100);
      await notify(
        deps,
        seekerProfile.userId,
        "request.declined",
        {
          requestId,
          companyName: insiderSummary.companyName,
          refundedCredits,
        },
        `request:${requestId}:decline`
      );
    }
  } catch (err) {
    console.error(`[requests] failed to notify on decline for request ${requestId}`, err);
  }

  return updated;
}

export async function expire(deps: RequestsDeps, requestId: string): Promise<InsiderRequestRecord> {
  const record = await deps.db.requests.getById(requestId);
  if (!record) throw new Error(`Insider request ${requestId} not found`);
  if (record.state !== "SENT") return record;

  const toState = nextState(record.state as RequestState, "expire");
  const { rules } = await getRulesWithVersion(deps, record.rulesVersion);
  const entries = refundEntries(requestId, record.seekerProfileId, record.creditCost, rules.refundPercentOnExpiry);

  let updated: InsiderRequestRecord;
  try {
    updated = await deps.db.requests.applyTransition({
      idempotencyKey: `request:${requestId}:expire`,
      requestId,
      event: "expire",
      fromState: record.state,
      toState,
      ledgerEntries: entries,
      ledgerEventType: "request.expire",
    });
  } catch (err) {
    if (err instanceof RequestStateConflictError) {
      const current = await deps.db.requests.getById(requestId);
      if (current) return current;
    }
    throw err;
  }

  try {
    const seekerProfile = await deps.db.identity.getSeekerProfileById(record.seekerProfileId);
    const insiderSummary = await deps.db.insiders.getInsiderById(record.insiderProfileId);
    if (seekerProfile && insiderSummary) {
      const refundedCredits = Math.round((record.creditCost * rules.refundPercentOnExpiry) / 100);
      await notify(
        deps,
        seekerProfile.userId,
        "request.expired",
        {
          requestId,
          companyName: insiderSummary.companyName,
          refundedCredits,
        },
        `request:${requestId}:expire`
      );
    }
  } catch (err) {
    console.error(`[requests] failed to notify on expire for request ${requestId}`, err);
  }

  return updated;
}

export async function sweepExpiredSent(deps: RequestsDeps, now: Date): Promise<InsiderRequestRecord[]> {
  const { rules } = await getRulesWithVersion(deps);
  const deadlineMs = rules.responseWindowHours * 3600 * 1000;
  const sentRequests = await deps.db.requests.listByState("SENT");
  const overdue = sentRequests.filter((r) => now.getTime() - r.createdAt.getTime() >= deadlineMs);

  const results: InsiderRequestRecord[] = [];
  for (const request of overdue) {
    try {
      results.push(await expire(deps, request.id));
    } catch (err) {
      // This sweep is itself the safety net for lost per-request timers — one
      // bad/wedged row must not abort the pass and silently skip every other
      // overdue request behind it. Log and keep going.
      console.error(`[requests] sweepExpiredSent failed to expire request ${request.id}`, err);
    }
  }
  return results;
}

export interface SubmitProofInput {
  idempotencyKey: string;
  requestId: string;
  proofType: "screenshot" | "text";
  objectKey?: string;
  textContent?: string;
}

export async function submitProof(deps: RequestsDeps, input: SubmitProofInput): Promise<InsiderRequestRecord> {
  if (input.proofType === "screenshot" && !input.objectKey) {
    throw new MissingProofContentError("screenshot");
  }
  if (input.proofType === "text" && !input.textContent?.trim()) {
    throw new MissingProofContentError("text");
  }

  const record = await deps.db.requests.getById(input.requestId);
  if (!record) throw new Error(`Insider request ${input.requestId} not found`);
  const toState = nextState(record.state as RequestState, "proof");

  return deps.db.requests.submitProof({
    idempotencyKey: `proof:${input.requestId}:${input.idempotencyKey}`,
    requestId: input.requestId,
    fromState: record.state,
    toState,
    proofType: input.proofType,
    objectKey: input.objectKey,
    textContent: input.textContent,
  });
}
