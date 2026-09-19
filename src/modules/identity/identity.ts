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

  const profile = await deps.db.identity.findOrCreateInsiderProfile(userId, company.id, workEmail);
  const code = generateOtpCode();
  await deps.db.identity.storeWorkEmailOtp(profile.id, hashOtpCode(code), new Date(Date.now() + OTP_TTL_MS));
  return { insiderProfileId: profile.id, code };
}

export async function verifyWorkEmailOtp(deps: IdentityDeps, insiderProfileId: string, code: string): Promise<boolean> {
  const valid = await deps.db.identity.consumeWorkEmailOtp(insiderProfileId, hashOtpCode(code), new Date());
  if (valid) await deps.db.identity.markInsiderVerified(insiderProfileId, new Date());
  return valid;
}
