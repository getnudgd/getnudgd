import { ZodError } from "zod";
import { WorkEmailDomainError, InsiderCompanyChangeError } from "../modules/identity/identity";
import { InvalidTokenError } from "../adapters/auth/types";

export type ProblemType =
  | "work-email-domain-not-registered"
  | "insider-company-change-not-allowed"
  | "otp-invalid-or-expired"
  | "auth-invalid-token"
  | "dev-login-wrong-code"
  | "rate-limited"
  | "validation-failed"
  | "unexpected";

export interface Problem {
  type: ProblemType;
  title: string;
}

const TITLES: Record<ProblemType, string> = {
  "work-email-domain-not-registered": "We don't recognize that work email's domain yet.",
  "insider-company-change-not-allowed": "You're already verified with a different company — contact support to change it.",
  "otp-invalid-or-expired": "That code is wrong or has expired. Try again or request a new one.",
  "auth-invalid-token": "Your sign-in link is invalid or has expired.",
  "dev-login-wrong-code": "That code is wrong.",
  "rate-limited": "Too many attempts — please wait a bit and try again.",
  "validation-failed": "Please check the highlighted fields and try again.",
  unexpected: "Something went wrong. Please try again.",
};

/** For a known, named condition that isn't a thrown JS error (e.g. a boolean check that returned false). */
export function problem(type: ProblemType): Problem {
  return { type, title: TITLES[type] };
}

/** For a genuinely caught exception. Never renders the error's own .message — copy comes only from TITLES. */
export function mapErrorToProblem(err: unknown): Problem {
  if (err instanceof ZodError) return problem("validation-failed");
  if (err instanceof WorkEmailDomainError) return problem("work-email-domain-not-registered");
  if (err instanceof InsiderCompanyChangeError) return problem("insider-company-change-not-allowed");
  if (err instanceof InvalidTokenError) return problem("auth-invalid-token");
  return problem("unexpected");
}
