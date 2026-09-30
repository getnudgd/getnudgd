import { eq, and, sum, isNull, isNotNull, gt, lt, asc, desc, type SQL } from "drizzle-orm";
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
  resumes,
  insiderRequests,
  requestEvents,
  verificationProofs,
  adminAuditLog,
  notifications,
  insiderRewards,
  rewardRedemptions,
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
  ResumeRecord,
  InsiderSearchFilters,
  InsiderSearchResult,
  InsiderRequestRecord,
  VerificationProofRecord,
  AdminAuditLogRecord,
  NotificationRecord,
  InsiderRewardRecord,
  PostLedgerEntryInput,
  ReleaseTrancheInput,
  RewardRedemptionRecord,
} from "./types";
import {
  LedgerImbalanceError,
  InsufficientBalanceError,
  RequestStateConflictError,
  InsufficientPointsError,
  RedemptionAlreadyResolvedError,
  assertSingleCurrency,
  assertValidTrancheInput,
} from "./types";

const REDEMPTION_IDEMPOTENCY_CONSTRAINT = "reward_redemptions_idempotency_key_uq";

// Fixed ledger lock order: platform, seeker, insider, escrow (escrow always last).
const OWNER_LOCK_ORDER: Record<LedgerOwnerType, number> = { platform: 0, seeker: 1, insider: 2, escrow: 3 };

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// True when err (or a wrapped cause) is a Postgres unique violation on the redemption idempotency index.
function isRedemptionIdempotencyViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth++) {
    const e = current as { code?: unknown; constraint?: unknown; message?: unknown; cause?: unknown };
    if (e.code === "23505") {
      if (e.constraint === REDEMPTION_IDEMPOTENCY_CONSTRAINT) return true;
      if (typeof e.message === "string" && e.message.includes(REDEMPTION_IDEMPOTENCY_CONSTRAINT)) return true;
    }
    current = e.cause;
  }
  return false;
}

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
  type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

  // Posts a ledger transaction inside an open transaction: find-or-create each account
  // (locking existing rows FOR UPDATE), insert the txn and its entries. Returns the txn id.
  async function postEntriesInTx(
    tx: Tx,
    idempotencyKey: string,
    eventType: string,
    entries: PostLedgerEntryInput[]
  ): Promise<string> {
    assertZeroSum(entries);
    assertSingleCurrency(entries);
    // Lock accounts in a fixed order (platform, seeker, insider, escrow; ties by ownerId) so concurrent
    // transactions can never deadlock on each other.
    const ordered = [...entries].sort(
      (a, b) => OWNER_LOCK_ORDER[a.ownerType] - OWNER_LOCK_ORDER[b.ownerType] || compareText(a.ownerId, b.ownerId)
    );
    const [txnRow] = await tx.insert(ledgerTxns).values({ idempotencyKey, eventType }).returning();
    for (const entry of ordered) {
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
      await tx.insert(ledgerEntries).values({ txnId: txnRow.id, accountId: account.id, currency: entry.currency, amount: entry.amount });
    }
    return txnRow.id;
  }

  async function releaseTrancheInTx(tx: Tx, input: ReleaseTrancheInput): Promise<InsiderRewardRecord> {
    assertValidTrancheInput(input);
    const [existing] = await tx
      .select()
      .from(insiderRewards)
      .where(and(eq(insiderRewards.requestId, input.requestId), eq(insiderRewards.tranche, input.tranche)));
    if (existing) return existing as InsiderRewardRecord;
    const ledgerTxnId = await postEntriesInTx(tx, `request:${input.requestId}:tranche:${input.tranche}`, "reward.tranche", [
      { ownerType: "platform", ownerId: "platform", currency: "points", amount: -input.points },
      { ownerType: "insider", ownerId: input.insiderProfileId, currency: "points", amount: input.points },
    ]);
    const [row] = await tx
      .insert(insiderRewards)
      .values({
        requestId: input.requestId,
        insiderProfileId: input.insiderProfileId,
        tranche: input.tranche,
        points: input.points,
        ledgerTxnId,
      })
      .returning();
    return row as InsiderRewardRecord;
  }

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
      async findOrCreateInsiderProfile(userId, companyId, workEmail) {
        const [existing] = await db.select().from(insiderProfiles).where(eq(insiderProfiles.userId, userId));
        if (existing) return existing as InsiderProfileRecord;
        const [created] = await db.insert(insiderProfiles).values({ userId, companyId, workEmail }).returning();
        return created as InsiderProfileRecord;
      },
      async updateInsiderProfileCompany(insiderProfileId, companyId, workEmail) {
        const [row] = await db
          .update(insiderProfiles)
          .set({ companyId, workEmail })
          .where(eq(insiderProfiles.id, insiderProfileId))
          .returning();
        if (!row) throw new Error(`Insider profile ${insiderProfileId} not found`);
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
        await db.transaction(async (tx) => {
          await tx
            .update(workEmailOtps)
            .set({ consumedAt: new Date() })
            .where(and(eq(workEmailOtps.insiderProfileId, insiderProfileId), isNull(workEmailOtps.consumedAt)));
          await tx.insert(workEmailOtps).values({ insiderProfileId, codeHash, expiresAt });
        });
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
      async getInsiderProfileById(insiderProfileId) {
        const [row] = await db.select().from(insiderProfiles).where(eq(insiderProfiles.id, insiderProfileId));
        return (row as InsiderProfileRecord) ?? null;
      },
      async getSeekerProfileById(seekerProfileId) {
        const [row] = await db.select().from(seekerProfiles).where(eq(seekerProfiles.id, seekerProfileId));
        return (row as SeekerProfileRecord) ?? null;
      },
      async getSeekerProfileByUserId(userId) {
        const [row] = await db.select().from(seekerProfiles).where(eq(seekerProfiles.userId, userId));
        return (row as SeekerProfileRecord) ?? null;
      },
      async getInsiderProfileByUserId(userId) {
        const [row] = await db.select().from(insiderProfiles).where(eq(insiderProfiles.userId, userId));
        return (row as InsiderProfileRecord) ?? null;
      },
      async createOrGetSeekerProfile(userId, fullName) {
        const [inserted] = await db
          .insert(seekerProfiles)
          .values({ userId, fullName })
          .onConflictDoNothing({ target: seekerProfiles.userId })
          .returning();
        if (inserted) return { record: inserted as SeekerProfileRecord, created: true };
        const [existing] = await db.select().from(seekerProfiles).where(eq(seekerProfiles.userId, userId));
        if (!existing) {
          throw new Error(`Seeker profile for user ${userId} vanished after a conflict`);
        }
        return { record: existing as SeekerProfileRecord, created: false };
      },
      async setUserRole(userId, role) {
        const [row] = await db.update(users).set({ role }).where(eq(users.id, userId)).returning();
        if (!row) throw new Error(`User ${userId} not found`);
        return row as UserRecord;
      },
      async setUserPhone(userId, phone) {
        const [row] = await db.update(users).set({ phone }).where(eq(users.id, userId)).returning();
        if (!row) throw new Error(`User ${userId} not found`);
      },
    },
    resumes: {
      async registerUpload(seekerProfileId, objectKey, originalFilename) {
        const [row] = await db
          .insert(resumes)
          .values({ seekerProfileId, objectKey, originalFilename })
          .returning();
        return row as ResumeRecord;
      },
      async getResumeById(resumeId) {
        const [row] = await db.select().from(resumes).where(eq(resumes.id, resumeId));
        return (row as ResumeRecord) ?? null;
      },
      async listResumesBySeekerProfileId(seekerProfileId) {
        const rows = await db.select().from(resumes).where(eq(resumes.seekerProfileId, seekerProfileId));
        return rows as ResumeRecord[];
      },
    },
    insiders: {
      async listInsiders(filters: InsiderSearchFilters) {
        const conditions = [eq(insiderProfiles.available, true), isNotNull(insiderProfiles.verifiedAt)];
        if (filters.companyId) conditions.push(eq(insiderProfiles.companyId, filters.companyId));

        const rows = await db
          .select({
            insiderProfileId: insiderProfiles.id,
            companyId: companies.id,
            companyName: companies.name,
            companyTier: companies.tier,
          })
          .from(insiderProfiles)
          .innerJoin(companies, eq(insiderProfiles.companyId, companies.id))
          .where(and(...conditions));

        return rows as InsiderSearchResult[];
      },
      async getInsiderById(insiderProfileId) {
        const [row] = await db
          .select({
            insiderProfileId: insiderProfiles.id,
            companyId: companies.id,
            companyName: companies.name,
            companyTier: companies.tier,
          })
          .from(insiderProfiles)
          .innerJoin(companies, eq(insiderProfiles.companyId, companies.id))
          .where(eq(insiderProfiles.id, insiderProfileId));
        return (row as InsiderSearchResult) ?? null;
      },
      async setAvailability(insiderProfileId, available) {
        await db.update(insiderProfiles).set({ available }).where(eq(insiderProfiles.id, insiderProfileId));
      },
    },
    // NOTE: applyTransition's race handling (a losing SELECT...FOR UPDATE re-reading the
    // winner's committed state and throwing RequestStateConflictError cleanly) depends on
    // READ COMMITTED isolation. If the connection pool this Database is constructed with is
    // ever configured for REPEATABLE READ or SERIALIZABLE, the identical race instead raises
    // a raw Postgres serialization-failure error that this code does not catch or retry —
    // whoever wires the real connection pool must either pin READ COMMITTED or add a
    // serialization-failure retry wrapper around these transactions.
    //
    // sendRequest's overspend protection below (SELECT ... FOR UPDATE on the seeker's ledger
    // account, then a separate SELECT summing ledgerEntries for the balance) has a sharper
    // dependency on the same isolation level: under READ COMMITTED, the balance SELECT takes
    // a fresh snapshot once the lock is acquired, so it correctly sees any concurrent spend
    // that committed while this transaction waited on the lock. Under REPEATABLE READ, the
    // whole transaction shares one snapshot taken before the lock wait, so the balance read
    // would still see the pre-lock snapshot and miss that concurrent spend — two overspending
    // calls could both pass the balance check and both commit, with no serialization error to
    // catch, because the locked account row itself is never updated. `rewards.createRedemption`
    // below locks and reads the insider's points account the same way and shares this exact
    // dependency. If this is ever run at a stricter isolation level, whoever wires the real
    // connection pool must pin READ COMMITTED explicitly or add a serialization-failure retry
    // wrapper around these transactions too.
    requests: {
      async sendRequest(input) {
        return db.transaction(async (tx) => {
          const [existingEvent] = await tx
            .select()
            .from(requestEvents)
            .where(eq(requestEvents.idempotencyKey, input.idempotencyKey));
          if (existingEvent) {
            const [existing] = await tx.select().from(insiderRequests).where(eq(insiderRequests.id, existingEvent.requestId));
            if (existing) return existing as InsiderRequestRecord;
          }

          let [seekerAccount] = await tx
            .select()
            .from(ledgerAccounts)
            .where(
              and(
                eq(ledgerAccounts.ownerType, "seeker"),
                eq(ledgerAccounts.ownerId, input.seekerProfileId),
                eq(ledgerAccounts.currency, "credits")
              )
            )
            .for("update");

          let balance = 0;
          if (seekerAccount) {
            const [row] = await tx
              .select({ total: sum(ledgerEntries.amount) })
              .from(ledgerEntries)
              .where(eq(ledgerEntries.accountId, seekerAccount.id));
            balance = Number(row?.total ?? 0);
          }
          if (balance < input.creditCost) {
            throw new InsufficientBalanceError("seeker", input.seekerProfileId, "credits", input.creditCost, balance);
          }

          if (!seekerAccount) {
            [seekerAccount] = await tx
              .insert(ledgerAccounts)
              .values({ ownerType: "seeker", ownerId: input.seekerProfileId, currency: "credits" })
              .returning();
          }

          const [requestRow] = await tx
            .insert(insiderRequests)
            .values({
              seekerProfileId: input.seekerProfileId,
              insiderProfileId: input.insiderProfileId,
              companyId: input.companyId,
              state: "SENT",
              creditCost: input.creditCost,
              rulesVersion: input.rulesVersion,
            })
            .returning();

          const [escrowAccount] = await tx
            .insert(ledgerAccounts)
            .values({ ownerType: "escrow", ownerId: requestRow.id, currency: "credits" })
            .returning();

          const [txnRow] = await tx
            .insert(ledgerTxns)
            .values({ idempotencyKey: `${input.idempotencyKey}:ledger`, eventType: "request.send" })
            .returning();

          await tx.insert(ledgerEntries).values([
            { txnId: txnRow.id, accountId: seekerAccount.id, currency: "credits", amount: -input.creditCost },
            { txnId: txnRow.id, accountId: escrowAccount.id, currency: "credits", amount: input.creditCost },
          ]);

          await tx.insert(requestEvents).values({
            requestId: requestRow.id,
            idempotencyKey: input.idempotencyKey,
            event: "send",
            fromState: null,
            toState: "SENT",
          });

          return requestRow as InsiderRequestRecord;
        });
      },
      async applyTransition(input) {
        return db.transaction(async (tx) => {
          const [existingEvent] = await tx
            .select()
            .from(requestEvents)
            .where(eq(requestEvents.idempotencyKey, input.idempotencyKey));
          if (existingEvent) {
            const [current] = await tx.select().from(insiderRequests).where(eq(insiderRequests.id, input.requestId));
            if (current) return current as InsiderRequestRecord;
          }

          const [current] = await tx
            .select()
            .from(insiderRequests)
            .where(eq(insiderRequests.id, input.requestId))
            .for("update");
          if (!current) throw new Error(`Insider request ${input.requestId} not found`);
          if (current.state !== input.fromState) {
            throw new RequestStateConflictError(input.requestId, input.fromState, current.state);
          }

          if (input.ledgerEntries.length > 0) {
            assertZeroSum(input.ledgerEntries);
          }
          // The tranche must go to the insider this request is addressed to; check before any write.
          if (input.trancheRelease && input.trancheRelease.points > 0) {
            assertValidTrancheInput(input.trancheRelease);
            if (input.trancheRelease.insiderProfileId !== current.insiderProfileId) {
              throw new Error(
                `Tranche release insider ${input.trancheRelease.insiderProfileId} does not match request ${input.requestId} insider ${current.insiderProfileId}`
              );
            }
          }

          const [updated] = await tx
            .update(insiderRequests)
            .set({ state: input.toState })
            .where(eq(insiderRequests.id, input.requestId))
            .returning();

          if (input.ledgerEntries.length > 0) {
            const [txnRow] = await tx
              .insert(ledgerTxns)
              .values({ idempotencyKey: `${input.idempotencyKey}:ledger`, eventType: input.ledgerEventType })
              .returning();

            for (const entry of input.ledgerEntries) {
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
              await tx
                .insert(ledgerEntries)
                .values({ txnId: txnRow.id, accountId: account.id, currency: entry.currency, amount: entry.amount });
            }
          }

          if (input.trancheRelease && input.trancheRelease.points > 0) {
            await releaseTrancheInTx(tx, { requestId: input.requestId, ...input.trancheRelease });
          }

          if (input.adminAudit) {
            await tx.insert(adminAuditLog).values({
              adminUserId: input.adminAudit.adminUserId,
              action: input.adminAudit.action,
              targetType: input.adminAudit.targetType,
              targetId: input.adminAudit.targetId,
              detail: input.adminAudit.detail,
            });
          }

          await tx.insert(requestEvents).values({
            requestId: input.requestId,
            idempotencyKey: input.idempotencyKey,
            event: input.event,
            fromState: input.fromState,
            toState: input.toState,
          });

          return updated as InsiderRequestRecord;
        });
      },
      async submitProof(input) {
        return db.transaction(async (tx) => {
          const [existingEvent] = await tx
            .select()
            .from(requestEvents)
            .where(eq(requestEvents.idempotencyKey, input.idempotencyKey));
          if (existingEvent) {
            const [existing] = await tx.select().from(insiderRequests).where(eq(insiderRequests.id, input.requestId));
            if (existing) return existing as InsiderRequestRecord;
          }

          const [current] = await tx
            .select()
            .from(insiderRequests)
            .where(eq(insiderRequests.id, input.requestId))
            .for("update");
          if (!current) throw new Error(`Insider request ${input.requestId} not found`);
          if (current.state !== input.fromState) {
            throw new RequestStateConflictError(input.requestId, input.fromState, current.state);
          }

          const [updated] = await tx
            .update(insiderRequests)
            .set({ state: input.toState })
            .where(eq(insiderRequests.id, input.requestId))
            .returning();

          await tx.insert(verificationProofs).values({
            requestId: input.requestId,
            proofType: input.proofType,
            objectKey: input.objectKey,
            textContent: input.textContent,
          });

          await tx.insert(requestEvents).values({
            requestId: input.requestId,
            idempotencyKey: input.idempotencyKey,
            event: "proof",
            fromState: input.fromState,
            toState: input.toState,
          });

          return updated as InsiderRequestRecord;
        });
      },
      async getById(requestId) {
        const [row] = await db.select().from(insiderRequests).where(eq(insiderRequests.id, requestId));
        return (row as InsiderRequestRecord) ?? null;
      },
      async listByState(state) {
        const rows = await db.select().from(insiderRequests).where(eq(insiderRequests.state, state));
        return rows as InsiderRequestRecord[];
      },
      async getProofByRequestId(requestId) {
        const [row] = await db
          .select()
          .from(verificationProofs)
          .where(eq(verificationProofs.requestId, requestId))
          .orderBy(desc(verificationProofs.createdAt))
          .limit(1);
        return (row as VerificationProofRecord) ?? null;
      },
      async listProofsByRequestId(requestId) {
        const rows = await db.select().from(verificationProofs).where(eq(verificationProofs.requestId, requestId));
        return rows as VerificationProofRecord[];
      },
      async listAuditLogByTarget(targetType, targetId) {
        const rows = await db
          .select()
          .from(adminAuditLog)
          .where(and(eq(adminAuditLog.targetType, targetType), eq(adminAuditLog.targetId, targetId)));
        return rows as AdminAuditLogRecord[];
      },
    },
    rewards: {
      async releaseTranche(input) {
        return db.transaction((tx) => releaseTrancheInTx(tx, input));
      },
      async listRewards(insiderProfileId) {
        const rows = await db
          .select()
          .from(insiderRewards)
          .where(eq(insiderRewards.insiderProfileId, insiderProfileId))
          .orderBy(desc(insiderRewards.releasedAt));
        return rows as InsiderRewardRecord[];
      },
      async createRedemption(input) {
        if (!Number.isInteger(input.points) || input.points <= 0) throw new Error("Redemption points must be a positive integer");
        try {
          return await db.transaction(async (tx) => {
            const [existing] = await tx
              .select()
              .from(rewardRedemptions)
              .where(eq(rewardRedemptions.idempotencyKey, input.idempotencyKey));
            if (existing) return { redemption: existing as RewardRedemptionRecord, created: false };

            // Lock the insider's points account, then re-check the key: a concurrent first call with the
            // same key may have committed while we waited, and that replay must not look like overspend.
            // Isolation-level caveat: see the NOTE above `requests.sendRequest` (~line 403) — this
            // lock-then-read-balance pattern is only correct under READ COMMITTED, for the same reason.
            const [account] = await tx
              .select()
              .from(ledgerAccounts)
              .where(
                and(
                  eq(ledgerAccounts.ownerType, "insider"),
                  eq(ledgerAccounts.ownerId, input.insiderProfileId),
                  eq(ledgerAccounts.currency, "points")
                )
              )
              .for("update");
            const [existingAfterLock] = await tx
              .select()
              .from(rewardRedemptions)
              .where(eq(rewardRedemptions.idempotencyKey, input.idempotencyKey));
            if (existingAfterLock) return { redemption: existingAfterLock as RewardRedemptionRecord, created: false };

            let balance = 0;
            if (account) {
              const [balanceRow] = await tx
                .select({ total: sum(ledgerEntries.amount) })
                .from(ledgerEntries)
                .where(eq(ledgerEntries.accountId, account.id));
              balance = Number(balanceRow?.total ?? 0);
            }
            if (balance < input.points) throw new InsufficientPointsError(input.insiderProfileId, input.points, balance);

            const [row] = await tx
              .insert(rewardRedemptions)
              .values({
                insiderProfileId: input.insiderProfileId,
                points: input.points,
                brand: input.brand,
                denominationPaise: input.denominationPaise,
                vendor: input.vendor,
                status: "pending",
                idempotencyKey: input.idempotencyKey,
              })
              .returning();
            await postEntriesInTx(tx, `redemption:${row.id}:hold`, "reward.redemption.hold", [
              { ownerType: "insider", ownerId: input.insiderProfileId, currency: "points", amount: -input.points },
              { ownerType: "escrow", ownerId: row.id, currency: "points", amount: input.points },
            ]);
            return { redemption: row as RewardRedemptionRecord, created: true };
          });
        } catch (err) {
          if (isRedemptionIdempotencyViolation(err)) {
            const [existing] = await db
              .select()
              .from(rewardRedemptions)
              .where(eq(rewardRedemptions.idempotencyKey, input.idempotencyKey));
            if (existing) return { redemption: existing as RewardRedemptionRecord, created: false };
          }
          throw err;
        }
      },
      async resolveRedemption(input) {
        return db.transaction(async (tx) => {
          // Lock order: the redemption row first, then ledger accounts (postEntriesInTx sorts them, escrow last).
          const [redemption] = await tx
            .select()
            .from(rewardRedemptions)
            .where(eq(rewardRedemptions.id, input.redemptionId))
            .for("update");
          if (!redemption) throw new Error(`Redemption ${input.redemptionId} not found`);
          if (redemption.status === input.outcome) return redemption as RewardRedemptionRecord;
          if (redemption.status !== "pending") {
            throw new RedemptionAlreadyResolvedError(redemption.id, redemption.status as RewardRedemptionRecord["status"]);
          }
          const rejectReason = input.rejectReason?.trim();
          if (input.outcome === "rejected" && !rejectReason) throw new Error("A reject reason is required");

          if (input.outcome === "fulfilled") {
            await postEntriesInTx(tx, `redemption:${redemption.id}:fulfil`, "reward.redemption.fulfil", [
              { ownerType: "platform", ownerId: "platform", currency: "points", amount: redemption.points },
              { ownerType: "escrow", ownerId: redemption.id, currency: "points", amount: -redemption.points },
            ]);
          } else {
            await postEntriesInTx(tx, `redemption:${redemption.id}:reject`, "reward.redemption.reject", [
              { ownerType: "insider", ownerId: redemption.insiderProfileId, currency: "points", amount: redemption.points },
              { ownerType: "escrow", ownerId: redemption.id, currency: "points", amount: -redemption.points },
            ]);
          }

          const [updated] = await tx
            .update(rewardRedemptions)
            .set({
              status: input.outcome,
              resolvedAt: new Date(),
              ...(input.outcome === "fulfilled" && input.vendorRef !== undefined ? { vendorRef: input.vendorRef } : {}),
              ...(input.outcome === "rejected" ? { rejectReason: rejectReason ?? null } : {}),
            })
            .where(eq(rewardRedemptions.id, redemption.id))
            .returning();

          if (input.adminAudit) {
            await tx.insert(adminAuditLog).values({
              adminUserId: input.adminAudit.adminUserId,
              action: input.adminAudit.action,
              targetType: input.adminAudit.targetType,
              targetId: input.adminAudit.targetId,
              detail: input.adminAudit.detail,
            });
          }
          return updated as RewardRedemptionRecord;
        });
      },
      async getRedemptionById(id) {
        const [row] = await db.select().from(rewardRedemptions).where(eq(rewardRedemptions.id, id));
        return (row as RewardRedemptionRecord) ?? null;
      },
      async listRedemptions(filter) {
        const conditions: SQL[] = [];
        if (filter?.status) conditions.push(eq(rewardRedemptions.status, filter.status));
        if (filter?.insiderProfileId) conditions.push(eq(rewardRedemptions.insiderProfileId, filter.insiderProfileId));
        const rows = await db
          .select()
          .from(rewardRedemptions)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(rewardRedemptions.createdAt));
        return rows as RewardRedemptionRecord[];
      },
      async getWallet(insiderProfileId) {
        const [balanceRow] = await db
          .select({ total: sum(ledgerEntries.amount) })
          .from(ledgerEntries)
          .innerJoin(ledgerAccounts, eq(ledgerEntries.accountId, ledgerAccounts.id))
          .where(
            and(
              eq(ledgerAccounts.ownerType, "insider"),
              eq(ledgerAccounts.ownerId, insiderProfileId),
              eq(ledgerAccounts.currency, "points")
            )
          );
        const [earnedRow] = await db
          .select({ total: sum(insiderRewards.points) })
          .from(insiderRewards)
          .where(eq(insiderRewards.insiderProfileId, insiderProfileId));
        const [pendingRow] = await db
          .select({ total: sum(rewardRedemptions.points) })
          .from(rewardRedemptions)
          .where(and(eq(rewardRedemptions.insiderProfileId, insiderProfileId), eq(rewardRedemptions.status, "pending")));
        return {
          balance: Number(balanceRow?.total ?? 0),
          lifetimeEarned: Number(earnedRow?.total ?? 0),
          pendingRedemptionPoints: Number(pendingRow?.total ?? 0),
        };
      },
    },
    notifications: {
      async create(input) {
        const [inserted] = await db
          .insert(notifications)
          .values({
            userId: input.userId,
            template: input.template,
            payload: input.payload,
            idempotencyKey: input.idempotencyKey,
          })
          .onConflictDoNothing({ target: notifications.idempotencyKey })
          .returning();
        if (inserted) return { record: inserted as NotificationRecord, created: true };
        const [existing] = await db
          .select()
          .from(notifications)
          .where(eq(notifications.idempotencyKey, input.idempotencyKey));
        if (!existing) {
          throw new Error(`Notification with idempotency key ${input.idempotencyKey} vanished after a conflict`);
        }
        return { record: existing as NotificationRecord, created: false };
      },
      async getById(id) {
        const [row] = await db.select().from(notifications).where(eq(notifications.id, id));
        return (row as NotificationRecord) ?? null;
      },
      async markSent(id, channel, deliveredAt) {
        await db.update(notifications).set({ status: "sent", channel, deliveredAt, error: null }).where(eq(notifications.id, id));
      },
      async markFailed(id, error) {
        await db.update(notifications).set({ status: "failed", error }).where(eq(notifications.id, id));
      },
      async listPendingOlderThan(cutoff, limit) {
        const rows = await db
          .select()
          .from(notifications)
          .where(and(eq(notifications.status, "pending"), lt(notifications.createdAt, cutoff)))
          .orderBy(asc(notifications.createdAt))
          .limit(limit);
        return rows as NotificationRecord[];
      },
    },
  };
}
