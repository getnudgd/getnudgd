import { eq, and, sum, isNull, isNotNull, gt, lt, asc, desc } from "drizzle-orm";
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
} from "./types";
import { LedgerImbalanceError, InsufficientBalanceError, RequestStateConflictError } from "./types";

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
    const [txnRow] = await tx.insert(ledgerTxns).values({ idempotencyKey, eventType }).returning();
    for (const entry of entries) {
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
    if (input.points <= 0) throw new Error("Tranche points must be positive");
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
      async getInsiderProfileById(insiderProfileId) {
        const [row] = await db.select().from(insiderProfiles).where(eq(insiderProfiles.id, insiderProfileId));
        return (row as InsiderProfileRecord) ?? null;
      },
      async getSeekerProfileById(seekerProfileId) {
        const [row] = await db.select().from(seekerProfiles).where(eq(seekerProfiles.id, seekerProfileId));
        return (row as SeekerProfileRecord) ?? null;
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
