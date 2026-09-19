import { eq, and, sum, isNull, gt } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  ledgerAccounts,
  ledgerTxns,
  ledgerEntries,
  appConfig,
  users,
  seekerProfiles,
  insiderProfiles,
  companies,
  companyDomains,
  workEmailOtps,
} from "../../../drizzle/schema";
import type {
  Database,
  LedgerAccountRecord,
  LedgerCurrency,
  LedgerOwnerType,
  PostLedgerTxnInput,
  UserRecord,
  CompanyRecord,
  SeekerProfileRecord,
  InsiderProfileRecord,
} from "./types";
import { LedgerImbalanceError } from "./types";

function toLedgerAccountRecord(row: {
  id: string;
  ownerType: string;
  ownerId: string;
  currency: string;
}): LedgerAccountRecord {
  return {
    id: row.id,
    ownerType: row.ownerType as LedgerOwnerType,
    ownerId: row.ownerId,
    currency: row.currency as LedgerCurrency,
  };
}

function assertZeroSum(entries: PostLedgerTxnInput["entries"]): void {
  const sums = new Map<LedgerCurrency, number>();
  for (const e of entries) sums.set(e.currency, (sums.get(e.currency) ?? 0) + e.amount);
  for (const [currency, total] of sums) {
    if (total !== 0) throw new LedgerImbalanceError(currency, total);
  }
}

export function createRealDatabase(db: NodePgDatabase): Database {
  return {
    ledger: {
      async postTxn(input) {
        assertZeroSum(input.entries);

        return db.transaction(async (tx) => {
          const [existing] = await tx
            .select()
            .from(ledgerTxns)
            .where(eq(ledgerTxns.idempotencyKey, input.idempotencyKey));

          if (existing) {
            const existingEntries = await tx.select().from(ledgerEntries).where(eq(ledgerEntries.txnId, existing.id));
            return {
              id: existing.id,
              idempotencyKey: existing.idempotencyKey,
              eventType: existing.eventType,
              createdAt: existing.createdAt,
              entries: existingEntries.map((e) => ({
                id: e.id,
                txnId: e.txnId,
                accountId: e.accountId,
                currency: e.currency as LedgerCurrency,
                amount: e.amount,
              })),
            };
          }

          const [txnRow] = await tx
            .insert(ledgerTxns)
            .values({ idempotencyKey: input.idempotencyKey, eventType: input.eventType })
            .returning();

          const entryRows = [];
          for (const entry of input.entries) {
            let [account] = await tx
              .select()
              .from(ledgerAccounts)
              .where(
                and(
                  eq(ledgerAccounts.ownerType, entry.ownerType),
                  eq(ledgerAccounts.ownerId, entry.ownerId),
                  eq(ledgerAccounts.currency, entry.currency)
                )
              )
              .for("update");

            if (!account) {
              [account] = await tx
                .insert(ledgerAccounts)
                .values({ ownerType: entry.ownerType, ownerId: entry.ownerId, currency: entry.currency })
                .returning();
            }

            const [entryRow] = await tx
              .insert(ledgerEntries)
              .values({ txnId: txnRow.id, accountId: account.id, currency: entry.currency, amount: entry.amount })
              .returning();
            entryRows.push(entryRow);
          }

          return {
            id: txnRow.id,
            idempotencyKey: txnRow.idempotencyKey,
            eventType: txnRow.eventType,
            createdAt: txnRow.createdAt,
            entries: entryRows.map((e) => ({
              id: e.id,
              txnId: e.txnId,
              accountId: e.accountId,
              currency: e.currency as LedgerCurrency,
              amount: e.amount,
            })),
          };
        });
      },
      async getBalance(ownerType, ownerId, currency) {
        const [account] = await db
          .select()
          .from(ledgerAccounts)
          .where(and(eq(ledgerAccounts.ownerType, ownerType), eq(ledgerAccounts.ownerId, ownerId), eq(ledgerAccounts.currency, currency)));
        if (!account) return 0;
        const [row] = await db
          .select({ total: sum(ledgerEntries.amount) })
          .from(ledgerEntries)
          .where(eq(ledgerEntries.accountId, account.id));
        return Number(row?.total ?? 0);
      },
      async findAccount(ownerType, ownerId, currency) {
        const [account] = await db
          .select()
          .from(ledgerAccounts)
          .where(and(eq(ledgerAccounts.ownerType, ownerType), eq(ledgerAccounts.ownerId, ownerId), eq(ledgerAccounts.currency, currency)));
        return account ? toLedgerAccountRecord(account) : null;
      },
    },
    config: {
      async getLatest(key) {
        const rows = await db.select().from(appConfig).where(eq(appConfig.key, key)).orderBy(appConfig.version);
        if (rows.length === 0) return null;
        return rows[rows.length - 1];
      },
      async getVersion(key, version) {
        const [row] = await db.select().from(appConfig).where(and(eq(appConfig.key, key), eq(appConfig.version, version)));
        return row ?? null;
      },
    },
    identity: {
      async findOrCreateUser(firebaseUid, email, role) {
        const [existing] = await db.select().from(users).where(eq(users.firebaseUid, firebaseUid));
        if (existing) return existing as UserRecord;
        const [created] = await db.insert(users).values({ firebaseUid, email, role }).returning();
        return created as UserRecord;
      },
      async getUserById(userId) {
        const [row] = await db.select().from(users).where(eq(users.id, userId));
        return (row as UserRecord) ?? null;
      },
      async createSeekerProfile(userId, fullName) {
        const [row] = await db.insert(seekerProfiles).values({ userId, fullName }).returning();
        return row as SeekerProfileRecord;
      },
      async createInsiderProfile(userId, companyId, workEmail) {
        const [row] = await db.insert(insiderProfiles).values({ userId, companyId, workEmail }).returning();
        return row as InsiderProfileRecord;
      },
      async findCompanyByDomain(domain) {
        const [row] = await db
          .select({ id: companies.id, name: companies.name, tier: companies.tier })
          .from(companyDomains)
          .innerJoin(companies, eq(companyDomains.companyId, companies.id))
          .where(eq(companyDomains.domain, domain));
        return row ? (row as CompanyRecord) : null;
      },
      async markInsiderVerified(insiderProfileId, verifiedAt) {
        await db.update(insiderProfiles).set({ verifiedAt }).where(eq(insiderProfiles.id, insiderProfileId));
      },
      async storeWorkEmailOtp(insiderProfileId, codeHash, expiresAt) {
        await db.insert(workEmailOtps).values({ insiderProfileId, codeHash, expiresAt });
      },
      async consumeWorkEmailOtp(insiderProfileId, codeHash, now) {
        const [otp] = await db
          .select()
          .from(workEmailOtps)
          .where(
            and(
              eq(workEmailOtps.insiderProfileId, insiderProfileId),
              eq(workEmailOtps.codeHash, codeHash),
              isNull(workEmailOtps.consumedAt),
              gt(workEmailOtps.expiresAt, now)
            )
          );
        if (!otp) return false;
        await db.update(workEmailOtps).set({ consumedAt: now }).where(eq(workEmailOtps.id, otp.id));
        return true;
      },
    },
  };
}
