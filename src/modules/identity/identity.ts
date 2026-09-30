import { createHash, randomInt } from "node:crypto";
import type { Database, Role } from "../../adapters/db/types";
import type { AuthAdapter } from "../../adapters/auth/types";

export interface IdentityDeps {
  db: Database;
  auth: AuthAdapter;
}

export interface SessionUser {
  userId: string;
  role: Role;
}

export interface CurrentUser {
  userId: string;
  role: Role;
  seekerProfileId: string | null;
  insiderProfile: { id: string; verifiedAt: Date | null } | null;
}

export async function signInWithFirebaseToken(deps: IdentityDeps, idToken: string): Promise<SessionUser> {
  const identity = await deps.auth.verifyIdToken(idToken);
  const user = await deps.db.identity.findOrCreateUser(identity.providerUid, identity.email, "seeker");
  return { userId: user.id, role: user.role };
}

export class WorkEmailDomainError extends Error {
  constructor(domain: string) {
    super(`No company is registered for the work email domain "${domain}"`);
    this.name = "WorkEmailDomainError";
  }
}

export class InsiderCompanyChangeError extends Error {
  constructor() {
    super("Cannot change employer for an already-verified Insider through this flow");
    this.name = "InsiderCompanyChangeError";
  }
}

export function promoteRoleForInsiderVerification(currentRole: Role): Role {
  if (currentRole === "seeker") return "both";
  return currentRole;
}

const OTP_TTL_MS = 10 * 60 * 1000;

function hashOtpCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export interface StartWorkEmailOtpResult {
  insiderProfileId: string;
  /** Caller (a server action) is responsible for emailing this — never log it or return it in an HTTP response body. */
  code: string;
}

export async function startWorkEmailOtp(
  deps: IdentityDeps,
  userId: string,
  workEmail: string
): Promise<StartWorkEmailOtpResult> {
  const domain = workEmail.split("@")[1]?.toLowerCase();
  if (!domain) throw new Error("Invalid work email");

  const company = await deps.db.identity.findCompanyByDomain(domain);
  if (!company) throw new WorkEmailDomainError(domain);

  let profile = await deps.db.identity.findOrCreateInsiderProfile(userId, company.id, workEmail);
  if (profile.companyId !== company.id || profile.workEmail !== workEmail) {
    if (profile.verifiedAt !== null) {
      throw new InsiderCompanyChangeError();
    }
    profile = await deps.db.identity.updateInsiderProfileCompany(profile.id, company.id, workEmail);
  }

  const code = generateOtpCode();
  await deps.db.identity.storeWorkEmailOtp(profile.id, hashOtpCode(code), new Date(Date.now() + OTP_TTL_MS));
  return { insiderProfileId: profile.id, code };
}

export async function verifyWorkEmailOtp(deps: IdentityDeps, insiderProfileId: string, code: string): Promise<boolean> {
  const valid = await deps.db.identity.consumeWorkEmailOtp(insiderProfileId, hashOtpCode(code), new Date());
  if (!valid) return false;

  await deps.db.identity.markInsiderVerified(insiderProfileId, new Date());

  const profile = await deps.db.identity.getInsiderProfileById(insiderProfileId);
  if (profile) {
    const user = await deps.db.identity.getUserById(profile.userId);
    if (user) {
      await deps.db.identity.setUserRole(user.id, promoteRoleForInsiderVerification(user.role));
    }
  }

  return true;
}

export async function getCurrentUserFromDb(deps: { db: Database }, userId: string): Promise<CurrentUser | null> {
  const user = await deps.db.identity.getUserById(userId);
  if (!user) return null;

  const [seekerProfile, insiderProfile] = await Promise.all([
    deps.db.identity.getSeekerProfileByUserId(userId),
    deps.db.identity.getInsiderProfileByUserId(userId),
  ]);

  return {
    userId: user.id,
    role: user.role,
    seekerProfileId: seekerProfile?.id ?? null,
    insiderProfile: insiderProfile ? { id: insiderProfile.id, verifiedAt: insiderProfile.verifiedAt } : null,
  };
}

export function resolveLanding(user: CurrentUser): "/admin" | "/onboard" | "/seeker/dashboard" | "/insider/dashboard" {
  if (user.role === "admin") return "/admin";
  if (user.seekerProfileId !== null) return "/seeker/dashboard";
  if (user.insiderProfile !== null && user.insiderProfile.verifiedAt !== null) return "/insider/dashboard";
  // An unverified (or absent) Insider profile with no Seeker profile both land here.
  return "/onboard";
}

export function canAccessAdmin(user: CurrentUser): boolean {
  return user.role === "admin";
}

export function canAccessSeekerApp(user: CurrentUser): boolean {
  return user.seekerProfileId !== null;
}

export function canAccessInsiderApp(user: CurrentUser): boolean {
  return user.insiderProfile !== null && user.insiderProfile.verifiedAt !== null;
}
