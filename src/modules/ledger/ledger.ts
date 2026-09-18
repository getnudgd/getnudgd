import type { Database, LedgerCurrency, LedgerOwnerType, LedgerTxnRecord } from "../../adapters/db/types";
import { LedgerImbalanceError } from "../../adapters/db/types";

export { LedgerImbalanceError };

export interface LedgerEntryInput {
  ownerType: LedgerOwnerType;
  ownerId: string;
  currency: LedgerCurrency;
  amount: number;
}

export interface PostTxnInput {
  idempotencyKey: string;
  eventType: string;
  entries: LedgerEntryInput[];
}

export interface LedgerDeps {
  db: Database;
}

function assertZeroSumPerCurrency(entries: LedgerEntryInput[]): void {
  const sums = new Map<LedgerCurrency, number>();
  for (const entry of entries) sums.set(entry.currency, (sums.get(entry.currency) ?? 0) + entry.amount);
  for (const [currency, total] of sums) {
    if (total !== 0) throw new LedgerImbalanceError(currency, total);
  }
}

export async function post(deps: LedgerDeps, input: PostTxnInput): Promise<LedgerTxnRecord> {
  if (input.entries.length === 0) {
    throw new Error("Ledger transaction must have at least one entry");
  }
  assertZeroSumPerCurrency(input.entries);
  return deps.db.ledger.postTxn(input);
}

export async function balance(
  deps: LedgerDeps,
  ownerType: LedgerOwnerType,
  ownerId: string,
  currency: LedgerCurrency
): Promise<number> {
  return deps.db.ledger.getBalance(ownerType, ownerId, currency);
}

export function escrowFor(requestId: string): { ownerType: "escrow"; ownerId: string } {
  return { ownerType: "escrow", ownerId: requestId };
}
