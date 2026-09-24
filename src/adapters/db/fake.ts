import {
  Database,
  LedgerAccountRecord,
  LedgerCurrency,
  LedgerOwnerType,
  LedgerTxnRecord,
  PostLedgerTxnInput,
  LedgerImbalanceError,
  AppConfigRecord,
  Role,
  UserRecord,
  CompanyRecord,
  SeekerProfileRecord,
  InsiderProfileRecord,
  ResumeRecord,
  InsiderSearchFilters,
  InsiderSearchResult,
  InsiderRequestRecord,
  RequestEventRecord,
  InsufficientBalanceError,
  RequestStateConflictError,
  VerificationProofRecord,
  AdminAuditLogRecord,
  NotificationRecord,
} from "./types";

function assertZeroSum(entries: PostLedgerTxnInput["entries"]): void {
  const sums = new Map<LedgerCurrency, number>();
  for (const e of entries) sums.set(e.currency, (sums.get(e.currency) ?? 0) + e.amount);
  for (const [currency, sum] of sums) {
    if (sum !== 0) throw new LedgerImbalanceError(currency, sum);
  }
}

export function createFakeDatabase(): {
  db: Database;
  seedConfig: (row: AppConfigRecord) => void;
  seedCompany: (input: { name: string; tier: string }, domains: string[]) => CompanyRecord;
} {
  const accounts: LedgerAccountRecord[] = [];
  const txns: LedgerTxnRecord[] = [];
  const configRows: AppConfigRecord[] = [];
  const users: UserRecord[] = [];
  const seekerProfiles: SeekerProfileRecord[] = [];
  const insiderProfiles: InsiderProfileRecord[] = [];
  const companies: CompanyRecord[] = [];
  const companyDomainToId = new Map<string, string>();
  const otps: { insiderProfileId: string; codeHash: string; expiresAt: Date; consumedAt: Date | null }[] = [];
  const resumeRows: ResumeRecord[] = [];
  const insiderRequestRows: InsiderRequestRecord[] = [];
  const requestEventRows: RequestEventRecord[] = [];
  const verificationProofRows: VerificationProofRecord[] = [];
  const adminAuditLogRows: AdminAuditLogRecord[] = [];
  const notificationRows: NotificationRecord[] = [];
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

  function toSearchResult(profile: InsiderProfileRecord): InsiderSearchResult | null {
    const company = companies.find((c) => c.id === profile.companyId);
    if (!company) return null;
    return { insiderProfileId: profile.id, companyId: company.id, companyName: company.name, companyTier: company.tier };
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
    identity: {
      async findOrCreateUser(firebaseUid: string, email: string, role: Role) {
        let user = users.find((u) => u.firebaseUid === firebaseUid);
        if (!user) {
          user = { id: genId(), firebaseUid, email, phone: null, role, createdAt: new Date() };
          users.push(user);
        }
        return user;
      },
      async getUserById(userId: string) {
        return users.find((u) => u.id === userId) ?? null;
      },
      async createSeekerProfile(userId: string, fullName: string) {
        const profile: SeekerProfileRecord = { id: genId(), userId, fullName };
        seekerProfiles.push(profile);
        return profile;
      },
      async findOrCreateInsiderProfile(userId: string, companyId: string, workEmail: string) {
        const existing = insiderProfiles.find((p) => p.userId === userId);
        if (existing) return existing;
        const profile: InsiderProfileRecord = {
          id: genId(), userId, companyId, workEmail, verifiedAt: null, available: true, weeklyLimit: 3,
        };
        insiderProfiles.push(profile);
        return profile;
      },
      async updateInsiderProfileCompany(insiderProfileId: string, companyId: string, workEmail: string) {
        const profile = insiderProfiles.find((p) => p.id === insiderProfileId);
        if (!profile) throw new Error(`Insider profile ${insiderProfileId} not found`);
        profile.companyId = companyId;
        profile.workEmail = workEmail;
        return profile;
      },
      async findCompanyByDomain(domain: string) {
        const companyId = companyDomainToId.get(domain);
        if (!companyId) return null;
        return companies.find((c) => c.id === companyId) ?? null;
      },
      async markInsiderVerified(insiderProfileId: string, verifiedAt: Date) {
        const profile = insiderProfiles.find((p) => p.id === insiderProfileId);
        if (profile) profile.verifiedAt = verifiedAt;
      },
      async storeWorkEmailOtp(insiderProfileId: string, codeHash: string, expiresAt: Date) {
        otps.push({ insiderProfileId, codeHash, expiresAt, consumedAt: null });
      },
      async consumeWorkEmailOtp(insiderProfileId: string, codeHash: string, now: Date) {
        const otp = otps.find(
          (o) => o.insiderProfileId === insiderProfileId && o.codeHash === codeHash && !o.consumedAt && o.expiresAt > now
        );
        if (!otp) return false;
        otp.consumedAt = now;
        return true;
      },
      async getInsiderProfileById(insiderProfileId: string) {
        return insiderProfiles.find((p) => p.id === insiderProfileId) ?? null;
      },
      async getSeekerProfileById(seekerProfileId: string) {
        return seekerProfiles.find((p) => p.id === seekerProfileId) ?? null;
      },
      async setUserRole(userId: string, role: Role) {
        const user = users.find((u) => u.id === userId);
        if (!user) throw new Error(`User ${userId} not found`);
        user.role = role;
        return user;
      },
      async setUserPhone(userId: string, phone: string) {
        const user = users.find((u) => u.id === userId);
        if (!user) throw new Error(`User ${userId} not found`);
        user.phone = phone;
      },
    },
    resumes: {
      async registerUpload(seekerProfileId: string, objectKey: string, originalFilename: string) {
        const resume: ResumeRecord = {
          id: genId(), seekerProfileId, objectKey, originalFilename, status: "uploaded", createdAt: new Date(),
        };
        resumeRows.push(resume);
        return resume;
      },
      async getResumeById(resumeId: string) {
        return resumeRows.find((r) => r.id === resumeId) ?? null;
      },
      async listResumesBySeekerProfileId(seekerProfileId: string) {
        return resumeRows.filter((r) => r.seekerProfileId === seekerProfileId);
      },
    },
    insiders: {
      async listInsiders(filters: InsiderSearchFilters) {
        return insiderProfiles
          .filter((p) => p.verifiedAt !== null && p.available)
          .filter((p) => !filters.companyId || p.companyId === filters.companyId)
          .map(toSearchResult)
          .filter((r): r is InsiderSearchResult => r !== null);
      },
      async getInsiderById(insiderProfileId: string) {
        const profile = insiderProfiles.find((p) => p.id === insiderProfileId);
        if (!profile) return null;
        return toSearchResult(profile);
      },
      async setAvailability(insiderProfileId: string, available: boolean) {
        const profile = insiderProfiles.find((p) => p.id === insiderProfileId);
        if (profile) profile.available = available;
      },
    },
    requests: {
      async sendRequest(input) {
        const existingEvent = requestEventRows.find((e) => e.idempotencyKey === input.idempotencyKey);
        if (existingEvent) {
          const existing = insiderRequestRows.find((r) => r.id === existingEvent.requestId);
          if (existing) return existing;
        }

        const seekerAccount = accounts.find(
          (a) => a.ownerType === "seeker" && a.ownerId === input.seekerProfileId && a.currency === "credits"
        );
        const balance = seekerAccount
          ? txns
              .flatMap((t) => t.entries)
              .filter((e) => e.accountId === seekerAccount.id)
              .reduce((sum, e) => sum + e.amount, 0)
          : 0;
        if (balance < input.creditCost) {
          throw new InsufficientBalanceError("seeker", input.seekerProfileId, "credits", input.creditCost, balance);
        }

        const requestId = genId();
        const record: InsiderRequestRecord = {
          id: requestId,
          seekerProfileId: input.seekerProfileId,
          insiderProfileId: input.insiderProfileId,
          companyId: input.companyId,
          state: "SENT",
          creditCost: input.creditCost,
          rulesVersion: input.rulesVersion,
          createdAt: new Date(),
        };
        insiderRequestRows.push(record);

        const seekerAcc = findOrCreateAccount("seeker", input.seekerProfileId, "credits");
        const escrowAcc = findOrCreateAccount("escrow", requestId, "credits");
        const txnId = genId();
        txns.push({
          id: txnId,
          idempotencyKey: `${input.idempotencyKey}:ledger`,
          eventType: "request.send",
          createdAt: new Date(),
          entries: [
            { id: genId(), txnId, accountId: seekerAcc.id, currency: "credits", amount: -input.creditCost },
            { id: genId(), txnId, accountId: escrowAcc.id, currency: "credits", amount: input.creditCost },
          ],
        });

        requestEventRows.push({
          id: genId(),
          requestId,
          idempotencyKey: input.idempotencyKey,
          event: "send",
          fromState: null,
          toState: "SENT",
          createdAt: new Date(),
        });

        return record;
      },
      async applyTransition(input) {
        const existingEvent = requestEventRows.find((e) => e.idempotencyKey === input.idempotencyKey);
        if (existingEvent) {
          const current = insiderRequestRows.find((r) => r.id === input.requestId);
          if (current) return current;
        }

        const current = insiderRequestRows.find((r) => r.id === input.requestId);
        if (!current) throw new Error(`Insider request ${input.requestId} not found`);
        if (current.state !== input.fromState) {
          throw new RequestStateConflictError(input.requestId, input.fromState, current.state);
        }

        if (input.ledgerEntries.length > 0) {
          assertZeroSum(input.ledgerEntries);
        }
        current.state = input.toState;

        if (input.ledgerEntries.length > 0) {
          const txnId = genId();
          const entries = input.ledgerEntries.map((e) => {
            const account = findOrCreateAccount(e.ownerType, e.ownerId, e.currency);
            return { id: genId(), txnId, accountId: account.id, currency: e.currency, amount: e.amount };
          });
          txns.push({
            id: txnId,
            idempotencyKey: `${input.idempotencyKey}:ledger`,
            eventType: input.ledgerEventType,
            createdAt: new Date(),
            entries,
          });
        }

        if (input.adminAudit) {
          adminAuditLogRows.push({
            id: genId(),
            adminUserId: input.adminAudit.adminUserId,
            action: input.adminAudit.action,
            targetType: input.adminAudit.targetType,
            targetId: input.adminAudit.targetId,
            detail: input.adminAudit.detail ?? null,
            createdAt: new Date(),
          });
        }

        requestEventRows.push({
          id: genId(),
          requestId: input.requestId,
          idempotencyKey: input.idempotencyKey,
          event: input.event,
          fromState: input.fromState,
          toState: input.toState,
          createdAt: new Date(),
        });

        return current;
      },
      async submitProof(input) {
        const existingEvent = requestEventRows.find((e) => e.idempotencyKey === input.idempotencyKey);
        if (existingEvent) {
          const existing = insiderRequestRows.find((r) => r.id === input.requestId);
          if (existing) return existing;
        }

        const current = insiderRequestRows.find((r) => r.id === input.requestId);
        if (!current) throw new Error(`Insider request ${input.requestId} not found`);
        if (current.state !== input.fromState) {
          throw new RequestStateConflictError(input.requestId, input.fromState, current.state);
        }

        current.state = input.toState;

        verificationProofRows.push({
          id: genId(),
          requestId: input.requestId,
          proofType: input.proofType,
          objectKey: input.objectKey ?? null,
          textContent: input.textContent ?? null,
          createdAt: new Date(),
        });

        requestEventRows.push({
          id: genId(),
          requestId: input.requestId,
          idempotencyKey: input.idempotencyKey,
          event: "proof",
          fromState: input.fromState,
          toState: input.toState,
          createdAt: new Date(),
        });

        return current;
      },
      async getById(requestId) {
        return insiderRequestRows.find((r) => r.id === requestId) ?? null;
      },
      async listByState(state) {
        return insiderRequestRows.filter((r) => r.state === state);
      },
      async getProofByRequestId(requestId) {
        const matches = verificationProofRows.filter((p) => p.requestId === requestId);
        return matches.length > 0 ? matches[matches.length - 1] : null;
      },
      async listProofsByRequestId(requestId) {
        return verificationProofRows.filter((p) => p.requestId === requestId);
      },
      async listAuditLogByTarget(targetType, targetId) {
        return adminAuditLogRows.filter((r) => r.targetType === targetType && r.targetId === targetId);
      },
    },
    notifications: {
      async create(input) {
        const existing = notificationRows.find((n) => n.idempotencyKey === input.idempotencyKey);
        if (existing) return { record: existing, created: false };
        const record: NotificationRecord = {
          id: genId(),
          userId: input.userId,
          template: input.template,
          payload: input.payload,
          status: "pending",
          channel: null,
          deliveredAt: null,
          error: null,
          idempotencyKey: input.idempotencyKey,
          createdAt: new Date(),
        };
        notificationRows.push(record);
        return { record, created: true };
      },
      async getById(id) {
        return notificationRows.find((n) => n.id === id) ?? null;
      },
      async markSent(id, channel, deliveredAt) {
        const record = notificationRows.find((n) => n.id === id);
        if (!record) throw new Error(`Notification ${id} not found`);
        record.status = "sent";
        record.channel = channel;
        record.deliveredAt = deliveredAt;
      },
      async markFailed(id, error) {
        const record = notificationRows.find((n) => n.id === id);
        if (!record) throw new Error(`Notification ${id} not found`);
        record.status = "failed";
        record.error = error;
      },
    },
  };

  return {
    db,
    seedConfig: (row: AppConfigRecord) => configRows.push(row),
    seedCompany: (input: { name: string; tier: string }, domains: string[]): CompanyRecord => {
      const company: CompanyRecord = { id: genId(), name: input.name, tier: input.tier };
      companies.push(company);
      for (const domain of domains) companyDomainToId.set(domain, company.id);
      return company;
    },
  };
}
