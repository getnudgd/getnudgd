import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getEnv, type Env } from "../config/env";
import type { Role } from "../adapters/db/types";

export interface SessionPayload {
  userId: string;
  role: Role;
  issuedAt: number;
}

const SESSION_COOKIE_NAME = "gn_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function encodeSession(payload: SessionPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function decodeSession(token: string, secret: string): SessionPayload | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const expected = sign(body, secret);
  const actual = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (actual.length !== expectedBuf.length || !timingSafeEqual(actual, expectedBuf)) return null;

  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
  } catch {
    return null;
  }
}

/**
 * SESSION_COOKIE_SECRET is still `.optional()` in env.ts as of Task 5 (Task 7 makes it
 * required). Narrow it here rather than widening SessionPayload's signature helpers to
 * accept `string | undefined`, and fail fast if a caller reaches this before Task 7 lands.
 */
function requireSessionSecret(env: Env): string {
  if (!env.SESSION_COOKIE_SECRET) {
    throw new Error("SESSION_COOKIE_SECRET is not configured");
  }
  return env.SESSION_COOKIE_SECRET;
}

export async function setSessionCookie(payload: SessionPayload): Promise<void> {
  const env = getEnv();
  const token = encodeSession(payload, requireSessionSecret(env));
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
  });
}

export async function getSessionFromCookies(): Promise<SessionPayload | null> {
  const env = getEnv();
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return decodeSession(token, requireSessionSecret(env));
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
}
