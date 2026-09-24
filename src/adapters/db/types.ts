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
  phone: string | null;
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

export interface InsiderRequestRecord {
  id: string;
  seekerProfileId: string;
  insiderProfileId: string;
  companyId: string;
  state: string;
  creditCost: number;
  rulesVersion: number;
  createdAt: Date;
}

export interface RequestEventRecord {
  id: string;
  requestId: string;
  idempotencyKey: string;
  event: string;
  fromState: string | null;
  toState: string;
  createdAt: Date;
}

export interface SendInsiderRequestInput {
  idempotencyKey: string;
  seekerProfileId: string;
  insiderProfileId: string;
  companyId: string;
  creditCost: number;
  rulesVersion: number;
}

export interface VerificationProofRecord {
  id: string;
  requestId: string;
  proofType: string;
  objectKey: string | null;
  textContent: string | null;
  createdAt: Date;
}

export interface AdminAuditLogRecord {
  id: string;
  adminUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  detail: string | null;
  createdAt: Date;
}

export type NotificationStatus = "pending" | "sent" | "failed";
export type NotificationChannel = "whatsapp_session" | "whatsapp_template" | "email";

export interface NotificationRecord {
  id: string;
  userId: string;
  template: string;
  payload: unknown;
  status: NotificationStatus;
  channel: NotificationChannel | null;
  deliveredAt: Date | null;
  error: string | null;
  idempotencyKey: string | null;
  createdAt: Date;
}

export interface CreateNotificationInput {
  userId: string;
  template: string;
  payload: unknown;
  idempotencyKey: string;
}

export interface SubmitProofInput {
  idempotencyKey: string;
  requestId: string;
  fromState: string;
  toState: string;
  proofType: string;
  objectKey?: string;
  textContent?: string;
}

export interface AdminAuditInput {
  adminUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  detail?: string;
}

export type RedemptionStatus = "pending" | "fulfilled" | "rejected";

export interface InsiderRewardRecord {
  id: string;
  requestId: string;
  insiderProfileId: string;
  tranche: number;
  points: number;
  ledgerTxnId: string;
  releasedAt: Date;
}

export interface RewardRedemptionRecord {
  id: string;
  insiderProfileId: string;
  points: number;
  brand: string;
  denominationPaise: number;
  vendor: string;
  vendorRef: string | null;
  status: RedemptionStatus;
  rejectReason: string | null;
  idempotencyKey: string;
  createdAt: Date;
  resolvedAt: Date | null;
}

export interface TrancheReleaseInput {
  insiderProfileId: string;
  tranche: 1 | 2;
  points: number;
}

export interface ReleaseTrancheInput extends TrancheReleaseInput {
  requestId: string;
}

export interface ApplyRequestTransitionInput {
  idempotencyKey: string;
  requestId: string;
  event: string;
  fromState: string;
  toState: string;
  ledgerEntries: PostLedgerEntryInput[];
  ledgerEventType: string;
  adminAudit?: AdminAuditInput;
  trancheRelease?: TrancheReleaseInput;
}

export interface CreateRedemptionInput {
  idempotencyKey: string;
  insiderProfileId: string;
  points: number;
  brand: string;
  denominationPaise: number;
  vendor: string;
}

export interface ResolveRedemptionInput {
  redemptionId: string;
  outcome: "fulfilled" | "rejected";
  vendorRef?: string;
  rejectReason?: string;
  adminAudit?: AdminAuditInput;
}

export interface WalletSummary {
  balance: number;
  lifetimeEarned: number;
  pendingRedemptionPoints: number;
}

// A points transaction must never mix with credits: reward and redemption txns are single-currency.
export function assertSingleCurrency(entries: readonly PostLedgerEntryInput[]): void {
  const currencies = new Set(entries.map((e) => e.currency));
  if (currencies.size > 1) throw new Error("Ledger transaction mixes currencies");
}

export function assertValidTrancheInput(input: { tranche: number; points: number }): void {
  if (!Number.isInteger(input.points) || input.points <= 0) throw new Error("Tranche points must be a positive integer");
  if (input.tranche !== 1 && input.tranche !== 2) throw new Error("Tranche must be 1 or 2");
}

export class InsufficientPointsError extends Error {
  constructor(insiderProfileId: string, required: number, available: number) {
    super(`Insider ${insiderProfileId} needs ${required} points but has ${available}`);
    this.name = "InsufficientPointsError";
  }
}

export class RedemptionAlreadyResolvedError extends Error {
  constructor(redemptionId: string, status: RedemptionStatus) {
    super(`Redemption ${redemptionId} is already ${status}`);
    this.name = "RedemptionAlreadyResolvedError";
  }
}

export class InsufficientBalanceError extends Error {
  constructor(ownerType: LedgerOwnerType, ownerId: string, currency: LedgerCurrency, required: number, available: number) {
    super(`Insufficient ${currency} balance for ${ownerType}:${ownerId} (need ${required}, have ${available})`);
    this.name = "InsufficientBalanceError";
  }
}

export class RequestStateConflictError extends Error {
  constructor(requestId: string, expectedState: string, actualState: string) {
    super(`Request ${requestId} expected state "${expectedState}" but was "${actualState}"`);
    this.name = "RequestStateConflictError";
  }
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
    getSeekerProfileById(seekerProfileId: string): Promise<SeekerProfileRecord | null>;
    setUserRole(userId: string, role: Role): Promise<UserRecord>;
    setUserPhone(userId: string, phone: string): Promise<void>;
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
  requests: {
    sendRequest(input: SendInsiderRequestInput): Promise<InsiderRequestRecord>;
    applyTransition(input: ApplyRequestTransitionInput): Promise<InsiderRequestRecord>;
    submitProof(input: SubmitProofInput): Promise<InsiderRequestRecord>;
    getById(requestId: string): Promise<InsiderRequestRecord | null>;
    listByState(state: string): Promise<InsiderRequestRecord[]>;
    getProofByRequestId(requestId: string): Promise<VerificationProofRecord | null>;
    listProofsByRequestId(requestId: string): Promise<VerificationProofRecord[]>;
    listAuditLogByTarget(targetType: string, targetId: string): Promise<AdminAuditLogRecord[]>;
  };
  rewards: {
    releaseTranche(input: ReleaseTrancheInput): Promise<InsiderRewardRecord>;
    listRewards(insiderProfileId: string): Promise<InsiderRewardRecord[]>;
    createRedemption(input: CreateRedemptionInput): Promise<{ redemption: RewardRedemptionRecord; created: boolean }>;
    resolveRedemption(input: ResolveRedemptionInput): Promise<RewardRedemptionRecord>;
    getRedemptionById(id: string): Promise<RewardRedemptionRecord | null>;
    listRedemptions(filter?: { status?: RedemptionStatus; insiderProfileId?: string }): Promise<RewardRedemptionRecord[]>;
    getWallet(insiderProfileId: string): Promise<WalletSummary>;
  };
  notifications: {
    create(input: CreateNotificationInput): Promise<{ record: NotificationRecord; created: boolean }>;
    getById(id: string): Promise<NotificationRecord | null>;
    markSent(id: string, channel: NotificationChannel, deliveredAt: Date): Promise<void>;
    markFailed(id: string, error: string): Promise<void>;
    listPendingOlderThan(cutoff: Date, limit: number): Promise<NotificationRecord[]>;
  };
}
