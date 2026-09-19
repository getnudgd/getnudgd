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

export type Role = "seeker" | "insider" | "admin" | "both";

export interface UserRecord {
  id: string;
  firebaseUid: string;
  email: string;
  role: Role;
  createdAt: Date;
}

export interface CompanyRecord {
  id: string;
  name: string;
  tier: string;
}

export interface SeekerProfileRecord {
  id: string;
  userId: string;
  fullName: string;
}

export interface InsiderProfileRecord {
  id: string;
  userId: string;
  companyId: string;
  workEmail: string;
  verifiedAt: Date | null;
  available: boolean;
  weeklyLimit: number;
}

export interface ResumeRecord {
  id: string;
  seekerProfileId: string;
  objectKey: string;
  originalFilename: string;
  status: string;
  createdAt: Date;
}

export interface InsiderSearchFilters {
  companyId?: string;
}

export interface InsiderSearchResult {
  insiderProfileId: string;
  companyId: string;
  companyName: string;
  companyTier: string;
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
  identity: {
    findOrCreateUser(firebaseUid: string, email: string, role: Role): Promise<UserRecord>;
    getUserById(userId: string): Promise<UserRecord | null>;
    createSeekerProfile(userId: string, fullName: string): Promise<SeekerProfileRecord>;
    findOrCreateInsiderProfile(userId: string, companyId: string, workEmail: string): Promise<InsiderProfileRecord>;
    updateInsiderProfileCompany(insiderProfileId: string, companyId: string, workEmail: string): Promise<InsiderProfileRecord>;
    findCompanyByDomain(domain: string): Promise<CompanyRecord | null>;
    markInsiderVerified(insiderProfileId: string, verifiedAt: Date): Promise<void>;
    storeWorkEmailOtp(insiderProfileId: string, codeHash: string, expiresAt: Date): Promise<void>;
    consumeWorkEmailOtp(insiderProfileId: string, codeHash: string, now: Date): Promise<boolean>;
    getInsiderProfileById(insiderProfileId: string): Promise<InsiderProfileRecord | null>;
    setUserRole(userId: string, role: Role): Promise<UserRecord>;
  };
  resumes: {
    registerUpload(seekerProfileId: string, objectKey: string, originalFilename: string): Promise<ResumeRecord>;
    getResumeById(resumeId: string): Promise<ResumeRecord | null>;
    listResumesBySeekerProfileId(seekerProfileId: string): Promise<ResumeRecord[]>;
  };
  insiders: {
    listInsiders(filters: InsiderSearchFilters): Promise<InsiderSearchResult[]>;
    getInsiderById(insiderProfileId: string): Promise<InsiderSearchResult | null>;
    setAvailability(insiderProfileId: string, available: boolean): Promise<void>;
  };
}
