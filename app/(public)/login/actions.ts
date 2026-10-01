"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getEnv } from "@/src/config/env";
import { devLoginInputSchema } from "@/src/modules/identity/schemas";
import { signInWithFirebaseToken, resolveLanding, getCurrentUserFromDb } from "@/src/modules/identity/identity";
import { createFakeAuthAdapter } from "@/src/adapters/auth/fake";
import { getAdapters } from "@/src/lib/adapters";
import { setSessionCookie } from "@/src/lib/session";
import { devLoginLimiter, limiterKey } from "@/src/lib/limiters";
import { problem, type Problem } from "@/src/lib/problems";

export type ActionResult = { ok: true } | { ok: false; problem: Problem };

const DEV_LOGIN_CODE = "000000";

export async function devLoginAction(input: { email: string; code: string }): Promise<ActionResult> {
  const env = getEnv();
  if (!env.DEV_LOGIN_ENABLED || env.NODE_ENV === "production") {
    return { ok: false, problem: problem("auth-invalid-token") };
  }

  const parsed = devLoginInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, problem: problem("validation-failed") };
  }
  const { email, code } = parsed.data;

  const requestHeaders = await headers();
  if (!devLoginLimiter.check(limiterKey(null, requestHeaders))) {
    return { ok: false, problem: problem("rate-limited") };
  }

  if (code !== DEV_LOGIN_CODE) {
    return { ok: false, problem: problem("dev-login-wrong-code") };
  }

  const providerUid = `dev:${email.toLowerCase()}`;
  const { issueToken } = createFakeAuthAdapter();
  const token = issueToken({ providerUid, email: email.toLowerCase() });

  const { db, auth } = getAdapters();
  const session = await signInWithFirebaseToken({ db, auth }, token);
  await setSessionCookie({ userId: session.userId, role: session.role, issuedAt: Date.now() });

  const currentUser = await getCurrentUserFromDb({ db }, session.userId);
  redirect(currentUser ? resolveLanding(currentUser) : "/onboard");
}
