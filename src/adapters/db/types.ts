export type LedgerOwnerType = "platform" | "seeker" | "insider" | "escrow";
export type LedgerCurrency = "credits" | "points";

export interface LedgerAccountRecord {
  id: string;
  ownerType: LedgerOwnerType;
  ownerId: string;
  currency: LedgerCurrency;
}

export interface LedgerEntryRecord {
  id: string;
  txnId: string;
  accountId: string;
  currency: LedgerCurrency;
  amount: number;
}

export interface LedgerTxnRecord {
  id: string;
  idempotencyKey: string;
  eventType: string;
  createdAt: Date;
  entries: LedgerEntryRecord[];
}

export interface PostLedgerEntryInput {
  ownerType: LedgerOwnerType;
  ownerId: string;
  currency: LedgerCurrency;
  amount: number;
}

export interface PostLedgerTxnInput {
  idempotencyKey: string;
  eventType: string;
  entries: PostLedgerEntryInput[];
}

export class LedgerImbalanceError extends Error {
  constructor(currency: LedgerCurrency, sum: number) {
    super(`Ledger transaction is not zero-sum for currency "${currency}" (sum=${sum})`);
    this.name = "LedgerImbalanceError";
  }
}

export interface AppConfigRecord {
  key: string;
  version: number;
  value: unknown;
  placeholder: boolean;
}

export interface Database {
  ledger: {
    postTxn(input: PostLedgerTxnInput): Promise<LedgerTxnRecord>;
    getBalance(ownerType: LedgerOwnerType, ownerId: string, currency: LedgerCurrency): Promise<number>;
    findAccount(ownerType: LedgerOwnerType, ownerId: string, currency: LedgerCurrency): Promise<LedgerAccountRecord | null>;
  };
  config: {
    getLatest(key: string): Promise<AppConfigRecord | null>;
    getVersion(key: string, version: number): Promise<AppConfigRecord | null>;
  };
}
