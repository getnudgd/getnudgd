"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import {
  createOrGetSeekerProfileInputSchema,
  requestWorkEmailOtpInputSchema,
  verifyWorkEmailOtpForUserInputSchema,
} from "@/src/modules/identity/schemas";
import {
  createOrGetSeekerProfile,
  requestWorkEmailOtp,
  resendWorkEmailOtp,
  verifyWorkEmailOtpForUser,
} from "@/src/modules/identity/identity";
import { getAdapters } from "@/src/lib/adapters";
import { getCurrentUser } from "@/src/lib/current-user";
import { authorize } from "@/src/lib/authorize";
import { otpSendLimiter, otpVerifyLimiter, limiterKey } from "@/src/lib/limiters";
import { problem, mapErrorToProblem, type Problem } from "@/src/lib/problems";

export type ActionResult = { ok: true } | { ok: false; problem: Problem };

export async function createSeekerProfileAction(input: { fullName: string }): Promise<ActionResult> {
  const currentUser = await getCurrentUser();
  if (!currentUser) return { ok: false, problem: problem("auth-invalid-token") };
  if (
    !authorize(
      { userId: currentUser.userId, role: currentUser.role },
      "update",
      { type: "seekerProfile", ownerUserId: currentUser.userId }
    )
  ) {
    return { ok: false, problem: problem("auth-invalid-token") };
  }

  const parsed = createOrGetSeekerProfileInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, problem: problem("validation-failed") };

  const { db } = getAdapters();
  await createOrGetSeekerProfile({ db }, currentUser.userId, parsed.data.fullName);
  redirect("/seeker/dashboard");
}

export async function requestInsiderOtpAction(input: { fullName: string; workEmail: string }): Promise<ActionResult> {
  const currentUser = await getCurrentUser();
  if (!currentUser) return { ok: false, problem: problem("auth-invalid-token") };
  if (
    !authorize(
      { userId: currentUser.userId, role: currentUser.role },
      "update",
      { type: "insiderProfile", ownerUserId: currentUser.userId }
    )
  ) {
    return { ok: false, problem: problem("auth-invalid-token") };
  }

  const parsed = requestWorkEmailOtpInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, problem: problem("validation-failed") };

  const requestHeaders = await headers();
  if (!otpSendLimiter.check(limiterKey(currentUser.userId, requestHeaders))) {
    return { ok: false, problem: problem("rate-limited") };
  }

  const { db, email } = getAdapters();
  try {
    await requestWorkEmailOtp({ db, email }, currentUser.userId, parsed.data.workEmail);
  } catch (err) {
    return { ok: false, problem: mapErrorToProblem(err) };
  }
  return { ok: true };
}

export async function verifyInsiderOtpAction(input: { code: string }): Promise<ActionResult> {
  const currentUser = await getCurrentUser();
  if (!currentUser) return { ok: false, problem: problem("auth-invalid-token") };
  if (
    !authorize(
      { userId: currentUser.userId, role: currentUser.role },
      "update",
      { type: "insiderProfile", ownerUserId: currentUser.userId }
    )
  ) {
    return { ok: false, problem: problem("auth-invalid-token") };
  }

  const parsed = verifyWorkEmailOtpForUserInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, problem: problem("validation-failed") };

  const requestHeaders = await headers();
  if (!otpVerifyLimiter.check(limiterKey(currentUser.userId, requestHeaders))) {
    return { ok: false, problem: problem("rate-limited") };
  }

  const { db } = getAdapters();
  const ok = await verifyWorkEmailOtpForUser({ db }, currentUser.userId, parsed.data.code);
  if (!ok) return { ok: false, problem: problem("otp-invalid-or-expired") };

  // Fixed destination, not resolveLanding(refreshedUser): the common case reaching this line is
  // a Seeker adding the Insider role (?add=insider), who already has a Seeker profile.
  // resolveLanding prioritizes an existing Seeker profile over a verified Insider one (spec
  // §4.2's third-pass fix), so deriving the redirect from it here would send this exact user to
  // /seeker/dashboard right after they finished verifying as an Insider — the wrong outcome for
  // an action whose whole purpose is Insider verification.
  redirect("/insider/dashboard");
}

export async function resendInsiderOtpAction(): Promise<ActionResult> {
  const currentUser = await getCurrentUser();
  if (!currentUser) return { ok: false, problem: problem("auth-invalid-token") };
  if (
    !authorize(
      { userId: currentUser.userId, role: currentUser.role },
      "update",
      { type: "insiderProfile", ownerUserId: currentUser.userId }
    )
  ) {
    return { ok: false, problem: problem("auth-invalid-token") };
  }

  const requestHeaders = await headers();
  if (!otpSendLimiter.check(limiterKey(currentUser.userId, requestHeaders))) {
    return { ok: false, problem: problem("rate-limited") };
  }

  const { db, email } = getAdapters();
  const result = await resendWorkEmailOtp({ db, email }, currentUser.userId);
  if (!result) return { ok: false, problem: problem("auth-invalid-token") };
  return { ok: true };
}
