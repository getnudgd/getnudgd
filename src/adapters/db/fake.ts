import {
  Database,
  LedgerAccountRecord,
  LedgerCurrency,
  LedgerOwnerType,
  LedgerTxnRecord,
  PostLedgerTxnInput,
  LedgerImbalanceError,
  AppConfigRecord,
} from "./types";

function assertZeroSum(entries: PostLedgerTxnInput["entries"]): void {
  const sums = new Map<LedgerCurrency, number>();
  for (const e of entries) sums.set(e.currency, (sums.get(e.currency) ?? 0) + e.amount);
  for (const [currency, sum] of sums) {
    if (sum !== 0) throw new LedgerImbalanceError(currency, sum);
  }
}

export function createFakeDatabase(): { db: Database; seedConfig: (row: AppConfigRecord) => void } {
  const accounts: LedgerAccountRecord[] = [];
  const txns: LedgerTxnRecord[] = [];
  const configRows: AppConfigRecord[] = [];
  let nextId = 1;
  const genId = () => `fake-${nextId++}`;

  function findOrCreateAccount(ownerType: LedgerOwnerType, ownerId: string, currency: LedgerCurrency): LedgerAccountRecord {
    let account = accounts.find((a) => a.ownerType === ownerType && a.ownerId === ownerId && a.currency === currency);
    if (!account) {
      account = { id: genId(), ownerType, ownerId, currency };
      accounts.push(account);
    }
    return account;
  }

  const db: Database = {
    ledger: {
      async postTxn(input) {
        const existing = txns.find((t) => t.idempotencyKey === input.idempotencyKey);
        if (existing) return existing;

        assertZeroSum(input.entries);

        const txnId = genId();
        const entries = input.entries.map((e) => {
          const account = findOrCreateAccount(e.ownerType, e.ownerId, e.currency);
          return { id: genId(), txnId, accountId: account.id, currency: e.currency, amount: e.amount };
        });
        const txn: LedgerTxnRecord = {
          id: txnId,
          idempotencyKey: input.idempotencyKey,
          eventType: input.eventType,
          createdAt: new Date(),
          entries,
        };
        txns.push(txn);
        return txn;
      },
      async getBalance(ownerType, ownerId, currency) {
        const account = accounts.find((a) => a.ownerType === ownerType && a.ownerId === ownerId && a.currency === currency);
        if (!account) return 0;
        return txns
          .flatMap((t) => t.entries)
          .filter((e) => e.accountId === account.id)
          .reduce((sum, e) => sum + e.amount, 0);
      },
      async findAccount(ownerType, ownerId, currency) {
        return accounts.find((a) => a.ownerType === ownerType && a.ownerId === ownerId && a.currency === currency) ?? null;
      },
    },
    config: {
      async getLatest(key) {
        const rows = configRows.filter((r) => r.key === key);
        if (rows.length === 0) return null;
        return rows.reduce((latest, r) => (r.version > latest.version ? r : latest));
      },
      async getVersion(key, version) {
        return configRows.find((r) => r.key === key && r.version === version) ?? null;
      },
    },
  };

  return { db, seedConfig: (row: AppConfigRecord) => configRows.push(row) };
}
