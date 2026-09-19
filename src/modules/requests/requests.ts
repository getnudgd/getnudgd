import type { Database, InsiderRequestRecord, PostLedgerEntryInput } from "../../adapters/db/types";
import { RequestStateConflictError } from "../../adapters/db/types";
import { getRulesWithVersion } from "../config/config";
import { UnknownCompanyTierError } from "../insiders/insiders";
import { escrowFor, platformAccount } from "../ledger/ledger";
import { nextState, type RequestState } from "./state";

export interface RequestsDeps {
  db: Database;
}

export class InsiderUnavailableError extends Error {
  constructor(insiderProfileId: string) {
    super(`Insider ${insiderProfileId} is not available to receive requests (not verified or not available)`);
    this.name = "InsiderUnavailableError";
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

  return deps.db.requests.sendRequest({
    idempotencyKey: `send:${input.idempotencyKey}`,
    seekerProfileId: input.seekerProfileId,
    insiderProfileId: input.insiderProfileId,
    companyId: profile.companyId,
    creditCost,
    rulesVersion,
  });
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

  return deps.db.requests.applyTransition({
    idempotencyKey: `request:${requestId}:accept`,
    requestId,
    event: "accept",
    fromState: record.state,
    toState,
    ledgerEntries: [],
    ledgerEventType: "request.accept",
  });
}

export async function decline(deps: RequestsDeps, requestId: string): Promise<InsiderRequestRecord> {
  const record = await deps.db.requests.getById(requestId);
  if (!record) throw new Error(`Insider request ${requestId} not found`);
  const toState = nextState(record.state as RequestState, "decline");
  const { rules } = await getRulesWithVersion(deps, record.rulesVersion);
  const entries = refundEntries(requestId, record.seekerProfileId, record.creditCost, rules.refundPercentOnDecline);

  return deps.db.requests.applyTransition({
    idempotencyKey: `request:${requestId}:decline`,
    requestId,
    event: "decline",
    fromState: record.state,
    toState,
    ledgerEntries: entries,
    ledgerEventType: "request.decline",
  });
}

export async function expire(deps: RequestsDeps, requestId: string): Promise<InsiderRequestRecord> {
  const record = await deps.db.requests.getById(requestId);
  if (!record) throw new Error(`Insider request ${requestId} not found`);
  if (record.state !== "SENT") return record;

  const toState = nextState(record.state as RequestState, "expire");
  const { rules } = await getRulesWithVersion(deps, record.rulesVersion);
  const entries = refundEntries(requestId, record.seekerProfileId, record.creditCost, rules.refundPercentOnExpiry);

  try {
    return await deps.db.requests.applyTransition({
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
}

export interface SubmitProofInput {
  idempotencyKey: string;
  requestId: string;
  proofType: "screenshot" | "text";
  objectKey?: string;
  textContent?: string;
}

export async function submitProof(deps: RequestsDeps, input: SubmitProofInput): Promise<InsiderRequestRecord> {
  const record = await deps.db.requests.getById(input.requestId);
  if (!record) throw new Error(`Insider request ${input.requestId} not found`);
  const toState = nextState(record.state as RequestState, "proof");

  return deps.db.requests.submitProof({
    idempotencyKey: `proof:${input.idempotencyKey}`,
    requestId: input.requestId,
    fromState: record.state,
    toState,
    proofType: input.proofType,
    objectKey: input.objectKey,
    textContent: input.textContent,
  });
}
