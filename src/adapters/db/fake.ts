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
          user = { id: genId(), firebaseUid, email, role, createdAt: new Date() };
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
      async setUserRole(userId: string, role: Role) {
        const user = users.find((u) => u.id === userId);
        if (!user) throw new Error(`User ${userId} not found`);
        user.role = role;
        return user;
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
