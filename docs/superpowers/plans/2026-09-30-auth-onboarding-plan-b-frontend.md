# Auth/Onboarding Plan B — Frontend: Pages, Actions, Guarded Shells

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/login`, `/onboard`, guard the three app-shell layouts, add placeholder dashboards, and prove the whole flow end-to-end with the repo's first browser-driven Playwright test.

**Architecture:** Every page and server action calls Plan A's functions directly (`getCurrentUser`, `resolveLanding`, `canAccessSeekerApp`/`canAccessInsiderApp`/`canAccessAdmin`, `createOrGetSeekerProfile`, `requestWorkEmailOtp`, `verifyWorkEmailOtpForUser`, `problem`/`mapErrorToProblem`, the three rate limiters). No decision logic is written in this plan — every `if` that decides *where a user goes* already exists in Plan A; this plan only calls it and renders the result. Server actions follow AGENTS.md §4.4's shape exactly: Zod parse → `authorize()` → one module call → redirect.

**Tech Stack:** Next.js 16 App Router (async Server Components, Server Actions), React 19, `components/ui/*` primitives (`Button`, `Input`, `Chip`, `Card`, `ErrorState`), Vitest + Testing Library, Playwright (browser mode, new to this repo).

**Spec:** `docs/superpowers/specs/2026-09-30-auth-onboarding-design.md` (read in full; this plan implements its §4.7–§4.9, §4.10's layout wiring, §4.12, and §5's Plan B testing).

**Depends on:** `docs/superpowers/plans/2026-09-30-auth-onboarding-plan-a-backend.md`, merged first. Every import below assumes Plan A's exports already exist: `getCurrentUser` (`src/lib/current-user.ts`), `resolveLanding`/`canAccessAdmin`/`canAccessSeekerApp`/`canAccessInsiderApp`/`createOrGetSeekerProfile`/`requestWorkEmailOtp`/`verifyWorkEmailOtpForUser`/`getCurrentUserFromDb` (`src/modules/identity/identity.ts`), `problem`/`mapErrorToProblem` (`src/lib/problems.ts`), `devLoginLimiter`/`otpSendLimiter`/`otpVerifyLimiter`/`limiterKey` (`src/lib/limiters.ts`), the four schema exports in `src/modules/identity/schemas.ts`, `getAdapters` (`src/lib/adapters.ts`), `authorize` (`src/lib/authorize.ts`).

## Global Constraints

- Tokens only in CSS — no arbitrary Tailwind values (AGENTS.md §4.3). This plan reuses existing classes (`.survey-wrap` for the 680px form width, `.seeker-scope`/`.insider-scope`, `.chips`, `.ui-card`, `.ui-input`, `.btn`/`.btn-primary`/`.btn-ghost`) and the `components/ui/*` primitives that already wrap them — no new CSS is added by this plan.
- Client components never import adapters, Drizzle, or vendor SDKs (AGENTS.md §4.4) — every page/component in this plan reaches the backend only through a server action or a server component's direct call to Plan A.
- Server-action wrappers are thin: Zod → `authorize()` → one module call → redirect/`revalidatePath` (AGENTS.md §4.4). No action in this plan contains its own decision logic.
- Every server action independently re-derives the current user and re-checks access — a layout's redirect is UX, never the enforcement boundary (spec §4.10's closing rule, unchanged from the first draft).
- Locked vocabulary in all copy: "Insider", "Seeker" (AGENTS.md §0.4). This plan's copy stays functional/minimal — no marketing copy is introduced.
- Brand name from `src/config/brand.ts`, never hardcoded (AGENTS.md §0.2).
- Every list screen implements all four states (loading/empty/error/populated) per AGENTS.md §4.6 — not applicable here: `/login` and `/onboard` are forms, not lists, and the placeholder dashboards (Task 4) are explicitly minimal, non-list pages; the four-states rule resumes once the real dashboards are built (future work).
- Money/points/credit display formatting (AGENTS.md §4.6) — not applicable to this plan; nothing in this slice displays currency.

## Review Focus

- A user with BOTH a Seeker profile and an unverified Insider profile visits `/onboard` directly with no `add` param. Per the spec's corrected `resolveLanding`, this user is "fully onboarded" (lands on `/seeker/dashboard`) — but `/onboard`'s own row 1 (resume the unverified-Insider OTP step) must still win, since it is checked before the "redirect away" row. Covered by Task 2's `step.test.ts`.
- A signed-in user with an *unverified* Insider profile navigates to `/insider/*`. The layout must redirect to `/onboard` (bare, no `add` param, since the profile already exists and only needs its OTP step resumed) — not `/onboard?add=insider` (which would be silently ignored anyway, but sending the wrong URL is still a defect). Covered by Task 3's insider layout test.
- The dev-login rate limiter must count *failed* attempts (wrong code), not only successful ones — otherwise an attacker gets unlimited guesses by never succeeding. Covered by Task 1's `actions.test.ts`.
- `verifyInsiderOtpAction`'s post-verification redirect must reflect the state *just* written by this same request (the Insider profile's `verifiedAt`), not a stale value from `getCurrentUser()`'s per-request cache captured earlier in the same action. Covered by Task 2's `actions.test.ts`.
- `/login` and `/onboard` must return a real 404 (via `notFound()`), not a blank or broken page, when `DEV_LOGIN_ENABLED` is false — so a real deployment never reveals these routes exist. Covered by Task 1's `page.test.tsx` for `/login`; `/onboard`'s own gate is session-based (redirect to `/login`), documented and tested in Task 2.

---

## Task 1: `/login` — dev sign-in page and action

**Files:**
- Create: `app/(public)/login/actions.ts`
- Create: `app/(public)/login/actions.test.ts`
- Create: `app/(public)/login/LoginForm.tsx`
- Create: `app/(public)/login/LoginForm.test.tsx`
- Create: `app/(public)/login/page.tsx`
- Create: `app/(public)/login/page.test.tsx`

**Interfaces:**
- Consumes: `getEnv` (`@/src/config/env`), `devLoginInputSchema` (`@/src/modules/identity/schemas`), `signInWithFirebaseToken`, `resolveLanding`, `getCurrentUserFromDb` (`@/src/modules/identity/identity`), `createFakeAuthAdapter` (`@/src/adapters/auth/fake`), `getAdapters` (`@/src/lib/adapters`), `setSessionCookie` (`@/src/lib/session`), `devLoginLimiter`/`limiterKey` (`@/src/lib/limiters`), `problem`/`type Problem` (`@/src/lib/problems`).
- Produces: `devLoginAction(input: { email: string; code: string }): Promise<{ ok: true } | { ok: false; problem: Problem }>`, exported `type ActionResult`.

- [ ] **Step 1: Write the failing action tests**

Create `app/(public)/login/actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});
vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
}));

const cookieStore = new Map<string, string>();
let currentIp = "10.0.0.1";
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieStore.has(name) ? { value: cookieStore.get(name)! } : undefined),
    set: (name: string, value: string) => {
      cookieStore.set(name, value);
    },
    delete: (name: string) => {
      cookieStore.delete(name);
    },
  }),
  headers: async () => new Headers({ "x-forwarded-for": currentIp }),
}));

import { resetEnvCacheForTests } from "@/src/config/env";
import { resetAdaptersCacheForTests } from "@/src/lib/adapters";
import { devLoginAction } from "./actions";

const REQUIRED_ENV = {
  APP_URL: "http://localhost:3000",
  BRAND_NAME: "GetNudgd",
  BRAND_DOMAIN: "getnudgd.com",
  DATABASE_URL: "postgres://getnudgd:getnudgd@localhost:5432/getnudgd",
  SESSION_COOKIE_SECRET: "a-test-secret-that-is-at-least-32-characters-long",
};

describe("devLoginAction", () => {
  const originalEnv = { ...process.env };
  let ipCounter = 0;

  beforeEach(() => {
    resetEnvCacheForTests();
    resetAdaptersCacheForTests();
    process.env = { ...originalEnv, NODE_ENV: "development", DEV_LOGIN_ENABLED: "true", ...REQUIRED_ENV };
    cookieStore.clear();
    redirectMock.mockClear();
    ipCounter++;
    currentIp = `10.0.0.${ipCounter}`; // unique per test — devLoginLimiter is keyed by IP alone (pre-auth), so tests must not share a bucket
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetEnvCacheForTests();
    resetAdaptersCacheForTests();
  });

  it("returns a problem when DEV_LOGIN_ENABLED is false", async () => {
    process.env.DEV_LOGIN_ENABLED = "false";
    resetEnvCacheForTests();
    const result = await devLoginAction({ email: "a@b.com", code: "000000" });
    expect(result).toEqual({ ok: false, problem: expect.objectContaining({ type: "auth-invalid-token" }) });
  });

  it("rejects the wrong code", async () => {
    const result = await devLoginAction({ email: "a@b.com", code: "111111" });
    expect(result).toEqual({ ok: false, problem: expect.objectContaining({ type: "dev-login-wrong-code" }) });
  });

  it("rejects an invalid email", async () => {
    const result = await devLoginAction({ email: "not-an-email", code: "000000" });
    expect(result).toEqual({ ok: false, problem: expect.objectContaining({ type: "validation-failed" }) });
  });

  it("signs in on the fixed dev code, sets a session cookie, and redirects a brand-new user to /onboard", async () => {
    await expect(devLoginAction({ email: "new-user@x.com", code: "000000" })).rejects.toThrow("REDIRECT:/onboard");
    expect(cookieStore.has("gn_session")).toBe(true);
  });

  it("denies after 5 failed attempts from the same IP, even though every attempt used a wrong code", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await devLoginAction({ email: "rl@x.com", code: "111111" });
      expect(r).toEqual({ ok: false, problem: expect.objectContaining({ type: "dev-login-wrong-code" }) });
    }
    const sixth = await devLoginAction({ email: "rl@x.com", code: "111111" });
    expect(sixth).toEqual({ ok: false, problem: expect.objectContaining({ type: "rate-limited" }) });
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx vitest run app/\(public\)/login/actions.test.ts`
Expected: FAIL — `./actions` module not found.

- [ ] **Step 3: Implement the action**

Create `app/(public)/login/actions.ts`:

```ts
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
```

- [ ] **Step 4: Run and verify it passes**

Run: `npx vitest run app/\(public\)/login/actions.test.ts`
Expected: PASS, all tests in the file green.

- [ ] **Step 5: Write the failing tests for `LoginForm`**

Create `app/(public)/login/LoginForm.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LoginForm } from "./LoginForm";
import { devLoginAction } from "./actions";

vi.mock("./actions", () => ({
  devLoginAction: vi.fn(),
}));

describe("LoginForm", () => {
  beforeEach(() => {
    vi.mocked(devLoginAction).mockReset();
  });

  it("starts on the email step and moves to the code step on Continue", () => {
    render(<LoginForm />);
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByLabelText("Code")).toBeInTheDocument();
  });

  it("blocks Continue on an invalid email without calling the server", () => {
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "not-an-email" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.queryByLabelText("Code")).not.toBeInTheDocument();
    expect(devLoginAction).not.toHaveBeenCalled();
  });

  it("submits email and code to devLoginAction and shows the problem title on failure", async () => {
    vi.mocked(devLoginAction).mockResolvedValue({
      ok: false,
      problem: { type: "dev-login-wrong-code", title: "That code is wrong." },
    });
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "111111" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(screen.getByText("That code is wrong.")).toBeInTheDocument());
    expect(devLoginAction).toHaveBeenCalledWith({ email: "a@b.com", code: "111111" });
  });

  it("lets the user go back to the email step", () => {
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Use a different email" }));
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run and verify it fails**

Run: `npx vitest run app/\(public\)/login/LoginForm.test.tsx`
Expected: FAIL — `./LoginForm` module not found.

- [ ] **Step 7: Implement `LoginForm`**

Create `app/(public)/login/LoginForm.tsx`:

```tsx
"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ErrorState } from "@/components/ui/ErrorState";
import { devLoginAction } from "./actions";
import type { Problem } from "@/src/lib/problems";

type Step = "email" | "code";

export function LoginForm() {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [problem, setProblem] = useState<Problem | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleContinue(e: FormEvent) {
    e.preventDefault();
    if (!email.includes("@")) {
      setProblem({ type: "validation-failed", title: "Enter a valid email address." });
      return;
    }
    setProblem(null);
    setStep("code");
  }

  function handleVerify(e: FormEvent) {
    e.preventDefault();
    setProblem(null);
    startTransition(async () => {
      const result = await devLoginAction({ email, code });
      if (!result.ok) setProblem(result.problem);
    });
  }

  return (
    <div className="survey-wrap">
      <h1>Sign in</h1>
      {step === "email" ? (
        <form onSubmit={handleContinue} noValidate>
          <label htmlFor="login-email">Email</label>
          <Input
            id="login-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={problem !== null}
            required
          />
          {problem && <ErrorState title={problem.title} />}
          <Button type="submit">Continue</Button>
        </form>
      ) : (
        <form onSubmit={handleVerify} noValidate>
          <p>Enter the 6-digit code sent to {email}.</p>
          <label htmlFor="login-code">Code</label>
          <Input
            id="login-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            error={problem !== null}
            required
          />
          {problem && <ErrorState title={problem.title} />}
          <Button type="submit" disabled={isPending}>
            {isPending ? "Verifying…" : "Sign in"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setStep("email")}>
            Use a different email
          </Button>
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 8: Run and verify it passes**

Run: `npx vitest run app/\(public\)/login/LoginForm.test.tsx`
Expected: PASS, all tests in the file green.

- [ ] **Step 9: Write the failing tests for `page.tsx`**

Create `app/(public)/login/page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

const notFoundMock = vi.fn(() => {
  throw new Error("NOT_FOUND");
});
vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
}));

import { resetEnvCacheForTests } from "@/src/config/env";
import LoginPage from "./page";

const REQUIRED_ENV = {
  APP_URL: "http://localhost:3000",
  BRAND_NAME: "GetNudgd",
  BRAND_DOMAIN: "getnudgd.com",
  DATABASE_URL: "postgres://getnudgd:getnudgd@localhost:5432/getnudgd",
  SESSION_COOKIE_SECRET: "a-test-secret-that-is-at-least-32-characters-long",
};

describe("LoginPage", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetEnvCacheForTests();
    process.env = { ...originalEnv, NODE_ENV: "development", ...REQUIRED_ENV };
    notFoundMock.mockClear();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetEnvCacheForTests();
  });

  it("renders the login form when DEV_LOGIN_ENABLED is true", () => {
    process.env.DEV_LOGIN_ENABLED = "true";
    resetEnvCacheForTests();
    render(<LoginPage />);
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("calls notFound() when DEV_LOGIN_ENABLED is false", () => {
    process.env.DEV_LOGIN_ENABLED = "false";
    resetEnvCacheForTests();
    expect(() => render(<LoginPage />)).toThrow("NOT_FOUND");
  });

  it("calls notFound() in production regardless of DEV_LOGIN_ENABLED (defense in depth on top of Plan A's getEnv() refusal, which already makes this combination unreachable in a real deployment)", () => {
    process.env.NODE_ENV = "production";
    process.env.DEV_LOGIN_ENABLED = "false";
    resetEnvCacheForTests();
    expect(() => render(<LoginPage />)).toThrow("NOT_FOUND");
  });
});
```

- [ ] **Step 10: Run and verify it fails**

Run: `npx vitest run app/\(public\)/login/page.test.tsx`
Expected: FAIL — `./page` module not found.

- [ ] **Step 11: Implement `page.tsx`**

Create `app/(public)/login/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { getEnv } from "@/src/config/env";
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  const env = getEnv();
  if (!env.DEV_LOGIN_ENABLED || env.NODE_ENV === "production") {
    notFound();
  }
  return <LoginForm />;
}
```

- [ ] **Step 12: Run the whole login test suite and typecheck**

Run: `npx vitest run "app/(public)/login" && npm run typecheck`
Expected: all green, no type errors.

- [ ] **Step 13: Commit**

```bash
git add "app/(public)/login"
git commit -m "feat(login): add dev sign-in page, two-step form, and devLoginAction"
```

---

## Task 2: `/onboard` — starting-step derivation, role choice, Seeker/Insider steps

**Files:**
- Create: `app/(public)/onboard/step.ts`
- Create: `app/(public)/onboard/step.test.ts`
- Create: `app/(public)/onboard/actions.ts`
- Create: `app/(public)/onboard/actions.test.ts`
- Create: `app/(public)/onboard/OnboardFlow.tsx`
- Create: `app/(public)/onboard/OnboardFlow.test.tsx`
- Create: `app/(public)/onboard/page.tsx`

**Interfaces:**
- Consumes: `getCurrentUser` (`@/src/lib/current-user`), `resolveLanding`, `getCurrentUserFromDb`, `createOrGetSeekerProfile`, `requestWorkEmailOtp`, `verifyWorkEmailOtpForUser` (`@/src/modules/identity/identity`), `createOrGetSeekerProfileInputSchema`/`requestWorkEmailOtpInputSchema`/`verifyWorkEmailOtpForUserInputSchema` (`@/src/modules/identity/schemas`), `getAdapters` (`@/src/lib/adapters`), `authorize` (`@/src/lib/authorize`), `otpSendLimiter`/`otpVerifyLimiter`/`limiterKey` (`@/src/lib/limiters`), `problem`/`mapErrorToProblem`/`type Problem` (`@/src/lib/problems`).
- Produces: `resolveStartingStep(user, add): "otp" | "seeker-name" | "insider-name-email" | "role-choice" | null` (pure — `null` means "fully onboarded, redirect away per `resolveLanding`"). `createSeekerProfileAction`, `requestInsiderOtpAction`, `verifyInsiderOtpAction`, each `(input) => Promise<{ ok: true } | { ok: false; problem: Problem }>`.

- [ ] **Step 1: Write the failing tests for `resolveStartingStep`**

Create `app/(public)/onboard/step.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveStartingStep } from "./step";

const noProfiles = { seekerProfileId: null, insiderProfile: null };

describe("resolveStartingStep", () => {
  it("row 1: resumes OTP entry for an unverified Insider profile, regardless of add or Seeker profile", () => {
    const user = { seekerProfileId: "sp1", insiderProfile: { verifiedAt: null } };
    expect(resolveStartingStep(user, undefined)).toBe("otp");
    expect(resolveStartingStep(user, "seeker")).toBe("otp");
  });

  it("row 2: add=seeker starts the Seeker-name step when no Seeker profile exists", () => {
    expect(resolveStartingStep(noProfiles, "seeker")).toBe("seeker-name");
  });

  it("row 2 does not fire when a Seeker profile already exists", () => {
    const user = { seekerProfileId: "sp1", insiderProfile: null };
    expect(resolveStartingStep(user, "seeker")).not.toBe("seeker-name");
  });

  it("row 3: add=insider starts the Insider name+email step when no Insider profile exists", () => {
    expect(resolveStartingStep(noProfiles, "insider")).toBe("insider-name-email");
  });

  it("row 4: no profiles and no add param shows the role-choice step", () => {
    expect(resolveStartingStep(noProfiles, undefined)).toBe("role-choice");
  });

  it("row 5: a Seeker profile with no add param, and no unverified Insider profile, resolves to null (redirect away)", () => {
    const user = { seekerProfileId: "sp1", insiderProfile: null };
    expect(resolveStartingStep(user, undefined)).toBeNull();
  });

  it("row 5: a verified Insider profile with no Seeker profile and no add param resolves to null (redirect away)", () => {
    const user = { seekerProfileId: null, insiderProfile: { verifiedAt: new Date() } };
    expect(resolveStartingStep(user, undefined)).toBeNull();
  });

  it("row 1 wins over row 5 even for a fully-onboarded-by-resolveLanding user: a Seeker profile plus an unverified Insider profile still resumes OTP, not a redirect away", () => {
    const user = { seekerProfileId: "sp1", insiderProfile: { verifiedAt: null } };
    expect(resolveStartingStep(user, undefined)).toBe("otp");
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx vitest run app/\(public\)/onboard/step.test.ts`
Expected: FAIL — `./step` module not found.

- [ ] **Step 3: Implement**

Create `app/(public)/onboard/step.ts`:

```ts
export type OnboardStep = "otp" | "seeker-name" | "insider-name-email" | "role-choice";
export type AddParam = "seeker" | "insider" | undefined;

interface OnboardUserState {
  seekerProfileId: string | null;
  insiderProfile: { verifiedAt: Date | null } | null;
}

/** Mirrors spec §4.9's ordered table exactly. Returns null when row 5 fires: fully onboarded, no matching add — the caller redirects via resolveLanding. */
export function resolveStartingStep(user: OnboardUserState, add: AddParam): OnboardStep | null {
  if (user.insiderProfile !== null && user.insiderProfile.verifiedAt === null) return "otp";
  if (add === "seeker" && user.seekerProfileId === null) return "seeker-name";
  if (add === "insider" && user.insiderProfile === null) return "insider-name-email";
  if (user.seekerProfileId === null && user.insiderProfile === null) return "role-choice";
  return null;
}
```

- [ ] **Step 4: Run and verify it passes**

Run: `npx vitest run app/\(public\)/onboard/step.test.ts`
Expected: PASS, all tests in the file green.

- [ ] **Step 5: Write the failing tests for the onboard actions**

Create `app/(public)/onboard/actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDatabase } from "@/src/adapters/db/fake";
import { createFakeEmailSender } from "@/src/adapters/email/fake";
import type { Database } from "@/src/adapters/db/types";
import type { EmailSender, EmailMessage } from "@/src/adapters/email/types";

const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});
vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
}));

let currentIp = "10.1.0.1";
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": currentIp }),
}));

const getCurrentUserMock = vi.fn();
vi.mock("@/src/lib/current-user", () => ({
  getCurrentUser: () => getCurrentUserMock(),
}));

// getAdapters() is mocked directly (rather than driven through real env/ADAPTERS
// bootstrapping) so each test can reach the fake db's seedCompany() helper —
// seedCompany only exists on createFakeDatabase()'s own return value, not on the
// Database interface getAdapters() normally exposes.
let testDb: Database;
let testEmailSender: EmailSender;
vi.mock("@/src/lib/adapters", () => ({
  getAdapters: () => ({ db: testDb, email: testEmailSender }),
}));

import { createSeekerProfileAction, requestInsiderOtpAction, verifyInsiderOtpAction } from "./actions";

describe("onboard actions", () => {
  let seedCompany: ReturnType<typeof createFakeDatabase>["seedCompany"];
  let emailSent: EmailMessage[];
  let ipCounter = 0;

  beforeEach(() => {
    const fakeDb = createFakeDatabase();
    testDb = fakeDb.db;
    seedCompany = fakeDb.seedCompany;
    const fakeEmail = createFakeEmailSender();
    testEmailSender = fakeEmail.sender;
    emailSent = fakeEmail.sent;

    redirectMock.mockClear();
    getCurrentUserMock.mockReset();
    ipCounter++;
    currentIp = `10.1.0.${ipCounter}`; // unique per test — otpSendLimiter/otpVerifyLimiter are keyed by userId+IP
  });

  describe("createSeekerProfileAction", () => {
    it("returns a problem when there is no session", async () => {
      getCurrentUserMock.mockResolvedValue(null);
      const result = await createSeekerProfileAction({ fullName: "Priya" });
      expect(result).toEqual({ ok: false, problem: expect.objectContaining({ type: "auth-invalid-token" }) });
    });

    it("creates the profile and redirects to /seeker/dashboard", async () => {
      const user = await testDb.identity.findOrCreateUser("fb-onb-seeker-1", "s1@x.com", "seeker");
      getCurrentUserMock.mockResolvedValue({ userId: user.id, role: "seeker", seekerProfileId: null, insiderProfile: null });

      await expect(createSeekerProfileAction({ fullName: "Priya" })).rejects.toThrow("REDIRECT:/seeker/dashboard");
      expect((await testDb.identity.getSeekerProfileByUserId(user.id))?.fullName).toBe("Priya");
    });

    it("rejects an empty full name", async () => {
      const user = await testDb.identity.findOrCreateUser("fb-onb-seeker-2", "s2@x.com", "seeker");
      getCurrentUserMock.mockResolvedValue({ userId: user.id, role: "seeker", seekerProfileId: null, insiderProfile: null });

      const result = await createSeekerProfileAction({ fullName: "" });
      expect(result).toEqual({ ok: false, problem: expect.objectContaining({ type: "validation-failed" }) });
    });
  });

  describe("requestInsiderOtpAction", () => {
    it("returns a problem when there is no session", async () => {
      getCurrentUserMock.mockResolvedValue(null);
      const result = await requestInsiderOtpAction({ fullName: "Rahul", workEmail: "r@acme.com" });
      expect(result).toEqual({ ok: false, problem: expect.objectContaining({ type: "auth-invalid-token" }) });
    });

    it("sends the OTP and returns ok for a registered domain", async () => {
      seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
      const user = await testDb.identity.findOrCreateUser("fb-onb-ins-1", "i1@x.com", "seeker");
      getCurrentUserMock.mockResolvedValue({ userId: user.id, role: "seeker", seekerProfileId: null, insiderProfile: null });

      const result = await requestInsiderOtpAction({ fullName: "Rahul", workEmail: "r1@acme.com" });
      expect(result).toEqual({ ok: true });
    });

    it("maps an unregistered domain to a problem instead of throwing to the caller", async () => {
      const user = await testDb.identity.findOrCreateUser("fb-onb-ins-2", "i2@x.com", "seeker");
      getCurrentUserMock.mockResolvedValue({ userId: user.id, role: "seeker", seekerProfileId: null, insiderProfile: null });

      const result = await requestInsiderOtpAction({ fullName: "Rahul", workEmail: "r2@unknown-domain.com" });
      expect(result).toEqual({ ok: false, problem: expect.objectContaining({ type: "work-email-domain-not-registered" }) });
    });

    it("denies after the send rate limit is exceeded", async () => {
      seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
      const user = await testDb.identity.findOrCreateUser("fb-onb-ins-3", "i3@x.com", "seeker");
      getCurrentUserMock.mockResolvedValue({ userId: user.id, role: "seeker", seekerProfileId: null, insiderProfile: null });

      for (let i = 0; i < 3; i++) {
        const r = await requestInsiderOtpAction({ fullName: "Rahul", workEmail: "r3@acme.com" });
        expect(r).toEqual({ ok: true });
      }
      const fourth = await requestInsiderOtpAction({ fullName: "Rahul", workEmail: "r3@acme.com" });
      expect(fourth).toEqual({ ok: false, problem: expect.objectContaining({ type: "rate-limited" }) });
    });
  });

  describe("verifyInsiderOtpAction", () => {
    it("returns a problem for a wrong code", async () => {
      seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
      const user = await testDb.identity.findOrCreateUser("fb-onb-verify-1", "v1@x.com", "seeker");
      getCurrentUserMock.mockResolvedValue({ userId: user.id, role: "seeker", seekerProfileId: null, insiderProfile: null });
      await requestInsiderOtpAction({ fullName: "Rahul", workEmail: "v1@acme.com" });

      const result = await verifyInsiderOtpAction({ code: "111111" });
      expect(result).toEqual({ ok: false, problem: expect.objectContaining({ type: "otp-invalid-or-expired" }) });
    });

    it("redirects to /insider/dashboard using the state just written by this same request, not a stale cached user", async () => {
      seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
      const user = await testDb.identity.findOrCreateUser("fb-onb-verify-2", "v2@x.com", "seeker");
      // getCurrentUserMock stays frozen at "no Insider profile yet" for the whole test, proving the
      // action does not rely on getCurrentUser() being re-called after verification succeeds.
      getCurrentUserMock.mockResolvedValue({ userId: user.id, role: "seeker", seekerProfileId: null, insiderProfile: null });

      await requestInsiderOtpAction({ fullName: "Rahul", workEmail: "v2@acme.com" });
      const code = emailSent[emailSent.length - 1]?.html.match(/\d{6}/)?.[0];

      await expect(verifyInsiderOtpAction({ code: code! })).rejects.toThrow("REDIRECT:/insider/dashboard");
    });
  });
});
```

- [ ] **Step 6: Run and verify it fails**

Run: `npx vitest run app/\(public\)/onboard/actions.test.ts`
Expected: FAIL — `./actions` module not found.

- [ ] **Step 7: Implement**

Create `app/(public)/onboard/actions.ts`:

```ts
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
  verifyWorkEmailOtpForUser,
  resolveLanding,
  getCurrentUserFromDb,
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

  // getCurrentUser() is request-scoped-cached and may have been called earlier in this same
  // request, before verification flipped verifiedAt — re-read directly from the DB so the
  // redirect reflects what was JUST written, not a stale cached CurrentUser.
  const refreshedUser = await getCurrentUserFromDb({ db }, currentUser.userId);
  redirect(refreshedUser ? resolveLanding(refreshedUser) : "/insider/dashboard");
}
```

- [ ] **Step 8: Run and verify it passes**

Run: `npx vitest run app/\(public\)/onboard/actions.test.ts`
Expected: PASS, all tests in the file green.

- [ ] **Step 9: Write the failing tests for `OnboardFlow`**

Create `app/(public)/onboard/OnboardFlow.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OnboardFlow } from "./OnboardFlow";
import { createSeekerProfileAction, requestInsiderOtpAction, verifyInsiderOtpAction } from "./actions";

vi.mock("./actions", () => ({
  createSeekerProfileAction: vi.fn(),
  requestInsiderOtpAction: vi.fn(),
  verifyInsiderOtpAction: vi.fn(),
}));

describe("OnboardFlow", () => {
  beforeEach(() => {
    vi.mocked(createSeekerProfileAction).mockReset();
    vi.mocked(requestInsiderOtpAction).mockReset();
    vi.mocked(verifyInsiderOtpAction).mockReset();
  });

  it("role-choice: choosing Seeker moves to the Seeker name step", () => {
    render(<OnboardFlow startingStep="role-choice" />);
    fireEvent.click(screen.getByRole("button", { name: "I'm looking for a job" }));
    expect(screen.getByLabelText("Full name")).toBeInTheDocument();
  });

  it("role-choice: choosing Insider moves to the Insider name+email step", () => {
    render(<OnboardFlow startingStep="role-choice" />);
    fireEvent.click(screen.getByRole("button", { name: "I'm an Insider" }));
    expect(screen.getByLabelText("Work email")).toBeInTheDocument();
  });

  it("seeker-name: submits fullName to createSeekerProfileAction", async () => {
    vi.mocked(createSeekerProfileAction).mockResolvedValue({ ok: true });
    render(<OnboardFlow startingStep="seeker-name" />);
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Priya" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(createSeekerProfileAction).toHaveBeenCalledWith({ fullName: "Priya" }));
  });

  it("insider-name-email: on success, moves to the OTP step", async () => {
    vi.mocked(requestInsiderOtpAction).mockResolvedValue({ ok: true });
    render(<OnboardFlow startingStep="insider-name-email" />);
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Rahul" } });
    fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "r@acme.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    await waitFor(() => expect(screen.getByLabelText("Code")).toBeInTheDocument());
  });

  it("insider-name-email: on failure, shows the problem title and stays on this step", async () => {
    vi.mocked(requestInsiderOtpAction).mockResolvedValue({
      ok: false,
      problem: { type: "work-email-domain-not-registered", title: "We don't recognize that work email's domain yet." },
    });
    render(<OnboardFlow startingStep="insider-name-email" />);
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Rahul" } });
    fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "r@nope.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    await waitFor(() =>
      expect(screen.getByText("We don't recognize that work email's domain yet.")).toBeInTheDocument()
    );
    expect(screen.queryByLabelText("Code")).not.toBeInTheDocument();
  });

  it("otp: submits the code to verifyInsiderOtpAction", async () => {
    vi.mocked(verifyInsiderOtpAction).mockResolvedValue({ ok: true });
    render(<OnboardFlow startingStep="otp" />);
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(verifyInsiderOtpAction).toHaveBeenCalledWith({ code: "123456" }));
  });

  it("otp: Resend code calls requestInsiderOtpAction again", async () => {
    vi.mocked(requestInsiderOtpAction).mockResolvedValue({ ok: true });
    render(<OnboardFlow startingStep="otp" />);
    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    await waitFor(() => expect(requestInsiderOtpAction).toHaveBeenCalledOnce());
  });

  it("otp: Use a different email goes back to the Insider name+email step", () => {
    render(<OnboardFlow startingStep="otp" />);
    fireEvent.click(screen.getByRole("button", { name: "Use a different email" }));
    expect(screen.getByLabelText("Work email")).toBeInTheDocument();
  });
});
```

- [ ] **Step 10: Run and verify it fails**

Run: `npx vitest run app/\(public\)/onboard/OnboardFlow.test.tsx`
Expected: FAIL — `./OnboardFlow` module not found.

- [ ] **Step 11: Implement `OnboardFlow`**

Create `app/(public)/onboard/OnboardFlow.tsx`:

```tsx
"use client";

import { useState, useTransition, type FormEvent, type MouseEvent } from "react";
import { Chip } from "@/components/ui/Chip";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ErrorState } from "@/components/ui/ErrorState";
import { createSeekerProfileAction, requestInsiderOtpAction, verifyInsiderOtpAction } from "./actions";
import type { OnboardStep } from "./step";
import type { Problem } from "@/src/lib/problems";

export function OnboardFlow({ startingStep }: { startingStep: OnboardStep }) {
  const [step, setStep] = useState<OnboardStep>(startingStep);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [isPending, startTransition] = useTransition();

  const [seekerFullName, setSeekerFullName] = useState("");
  const [insiderFullName, setInsiderFullName] = useState("");
  const [workEmail, setWorkEmail] = useState("");
  const [code, setCode] = useState("");

  function submitSeeker(e: FormEvent) {
    e.preventDefault();
    setProblem(null);
    startTransition(async () => {
      const result = await createSeekerProfileAction({ fullName: seekerFullName });
      if (!result.ok) setProblem(result.problem);
    });
  }

  function submitInsiderEmail(e: FormEvent) {
    e.preventDefault();
    setProblem(null);
    startTransition(async () => {
      const result = await requestInsiderOtpAction({ fullName: insiderFullName, workEmail });
      if (!result.ok) {
        setProblem(result.problem);
        return;
      }
      setStep("otp");
    });
  }

  function submitOtp(e: FormEvent) {
    e.preventDefault();
    setProblem(null);
    startTransition(async () => {
      const result = await verifyInsiderOtpAction({ code });
      if (!result.ok) setProblem(result.problem);
    });
  }

  function resend(e: MouseEvent) {
    e.preventDefault();
    setProblem(null);
    startTransition(async () => {
      const result = await requestInsiderOtpAction({ fullName: insiderFullName, workEmail });
      if (!result.ok) setProblem(result.problem);
    });
  }

  return (
    <div className="survey-wrap">
      {step === "role-choice" && (
        <div>
          <h1>How will you use GetNudgd?</h1>
          <div className="chips">
            <Chip onClick={() => setStep("seeker-name")}>I&apos;m looking for a job</Chip>
            <Chip onClick={() => setStep("insider-name-email")}>I&apos;m an Insider</Chip>
          </div>
        </div>
      )}

      {step === "seeker-name" && (
        <Card>
          <form onSubmit={submitSeeker} noValidate>
            <h1>What&apos;s your name?</h1>
            <label htmlFor="seeker-full-name">Full name</label>
            <Input
              id="seeker-full-name"
              value={seekerFullName}
              onChange={(e) => setSeekerFullName(e.target.value)}
              error={problem !== null}
              required
            />
            {problem && <ErrorState title={problem.title} />}
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving…" : "Continue"}
            </Button>
          </form>
        </Card>
      )}

      {step === "insider-name-email" && (
        <Card>
          <form onSubmit={submitInsiderEmail} noValidate>
            <h1>Verify your work email</h1>
            <label htmlFor="insider-full-name">Full name</label>
            <Input
              id="insider-full-name"
              value={insiderFullName}
              onChange={(e) => setInsiderFullName(e.target.value)}
              required
            />
            <label htmlFor="insider-work-email">Work email</label>
            <Input
              id="insider-work-email"
              type="email"
              autoComplete="email"
              value={workEmail}
              onChange={(e) => setWorkEmail(e.target.value)}
              error={problem !== null}
              required
            />
            {problem && <ErrorState title={problem.title} />}
            <Button type="submit" disabled={isPending}>
              {isPending ? "Sending…" : "Send code"}
            </Button>
          </form>
        </Card>
      )}

      {step === "otp" && (
        <Card>
          <form onSubmit={submitOtp} noValidate>
            <h1>Enter your code</h1>
            <p>We sent a 6-digit code to your work email.</p>
            <label htmlFor="insider-otp-code">Code</label>
            <Input
              id="insider-otp-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              error={problem !== null}
              required
            />
            {problem && <ErrorState title={problem.title} />}
            <Button type="submit" disabled={isPending}>
              {isPending ? "Verifying…" : "Verify"}
            </Button>
            <Button type="button" variant="ghost" onClick={resend} disabled={isPending}>
              Resend code
            </Button>
            <Button type="button" variant="ghost" onClick={() => setStep("insider-name-email")}>
              Use a different email
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 12: Run and verify it passes**

Run: `npx vitest run app/\(public\)/onboard/OnboardFlow.test.tsx`
Expected: PASS, all tests in the file green.

- [ ] **Step 13: Implement `page.tsx` (not independently unit-tested — see note)**

Create `app/(public)/onboard/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/src/lib/current-user";
import { resolveLanding } from "@/src/modules/identity/identity";
import { resolveStartingStep, type AddParam } from "./step";
import { OnboardFlow } from "./OnboardFlow";

export default async function OnboardPage({
  searchParams,
}: {
  searchParams: Promise<{ add?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { add: rawAdd } = await searchParams;
  const add: AddParam = rawAdd === "seeker" || rawAdd === "insider" ? rawAdd : undefined;

  const step = resolveStartingStep(user, add);
  if (step === null) redirect(resolveLanding(user));

  return <OnboardFlow startingStep={step} />;
}
```

This file is deliberately thin — every decision it makes is one call to `resolveStartingStep` (unit-tested in Step 1-4 above) or `resolveLanding` (unit-tested in Plan A). It is not given its own Testing-Library test: Next 16 async Server Components with an async `searchParams` prop are not renderable through `@testing-library/react`'s synchronous `render()` without a fuller Next test harness this repo doesn't have yet, and adding one is out of scope for this slice. The integrated, real behavior of this exact file is proven end-to-end by Task 5's browser Playwright test instead.

- [ ] **Step 14: Typecheck and run the onboard test suite**

Run: `npx vitest run "app/(public)/onboard" && npm run typecheck`
Expected: all green, no type errors.

- [ ] **Step 15: Commit**

```bash
git add "app/(public)/onboard"
git commit -m "feat(onboard): add /onboard with role choice, Seeker/Insider steps, and the starting-step table"
```

---

## Task 3: Guard the three app-shell layouts; add `logoutAction`

**Files:**
- Create: `app/actions.ts`
- Create: `app/actions.test.ts`
- Modify: `app/seeker/layout.tsx`
- Modify: `app/seeker/layout.test.tsx`
- Modify: `app/insider/layout.tsx`
- Modify: `app/insider/layout.test.tsx`
- Modify: `app/(admin)/admin/layout.tsx`
- Modify: `app/(admin)/admin/layout.test.tsx`

**Interfaces:**
- Consumes: `getCurrentUser` (`@/src/lib/current-user`), `canAccessAdmin`/`canAccessSeekerApp`/`canAccessInsiderApp` (`@/src/modules/identity/identity`), `clearSessionCookie` (`@/src/lib/session`).
- Produces: `logoutAction(): Promise<void>` in `app/actions.ts`, used by all three layouts.

- [ ] **Step 1: Write the failing test for `logoutAction`**

Create `app/actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});
vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
}));

const cookieStore = new Map<string, string>(["gn_session", "some-token"]);
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieStore.has(name) ? { value: cookieStore.get(name)! } : undefined),
    set: (name: string, value: string) => {
      cookieStore.set(name, value);
    },
    delete: (name: string) => {
      cookieStore.delete(name);
    },
  }),
}));

import { logoutAction } from "./actions";

describe("logoutAction", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    cookieStore.set("gn_session", "some-token");
  });

  it("clears the session cookie and redirects to /", async () => {
    await expect(logoutAction()).rejects.toThrow("REDIRECT:/");
    expect(cookieStore.has("gn_session")).toBe(false);
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx vitest run app/actions.test.ts`
Expected: FAIL — `./actions` module not found.

- [ ] **Step 3: Implement**

Create `app/actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { clearSessionCookie } from "@/src/lib/session";

export async function logoutAction(): Promise<void> {
  await clearSessionCookie();
  redirect("/");
}
```

- [ ] **Step 4: Run and verify it passes**

Run: `npx vitest run app/actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing tests for the Seeker layout**

Replace the contents of `app/seeker/layout.test.tsx` with:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});
vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
}));

const getCurrentUserMock = vi.fn();
vi.mock("@/src/lib/current-user", () => ({
  getCurrentUser: () => getCurrentUserMock(),
}));

import SeekerLayout from "./layout";

describe("SeekerLayout", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    getCurrentUserMock.mockReset();
  });

  it("redirects to /login when there is no session", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    await expect(SeekerLayout({ children: <p>Dashboard content</p> })).rejects.toThrow("REDIRECT:/login");
  });

  it("redirects to /onboard?add=seeker when signed in with no Seeker profile", async () => {
    getCurrentUserMock.mockResolvedValue({ userId: "u1", role: "insider", seekerProfileId: null, insiderProfile: { id: "ip1", verifiedAt: new Date() } });
    await expect(SeekerLayout({ children: <p>Dashboard content</p> })).rejects.toThrow("REDIRECT:/onboard?add=seeker");
  });

  it("renders the shell with the bottom nav for a user with a Seeker profile", async () => {
    getCurrentUserMock.mockResolvedValue({ userId: "u1", role: "seeker", seekerProfileId: "sp1", insiderProfile: null });
    const element = await SeekerLayout({ children: <p>Dashboard content</p> });
    render(element);
    expect(screen.getByText("Dashboard content")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Insiders" })).toHaveAttribute("href", "/seeker/insiders");
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
  });

  it("renders the shell for an admin even with no Seeker profile", async () => {
    getCurrentUserMock.mockResolvedValue({ userId: "admin-1", role: "admin", seekerProfileId: null, insiderProfile: null });
    const element = await SeekerLayout({ children: <p>Dashboard content</p> });
    render(element);
    expect(screen.getByText("Dashboard content")).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run and verify it fails**

Run: `npx vitest run app/seeker/layout.test.tsx`
Expected: FAIL — `SeekerLayout` is still a synchronous component with no session check, so every redirect-expecting test fails (renders instead of throwing) and `getCurrentUser`/`redirect` are never called.

- [ ] **Step 7: Implement the Seeker layout**

Replace the contents of `app/seeker/layout.tsx` with:

```tsx
import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/src/lib/current-user";
import { canAccessAdmin, canAccessSeekerApp } from "@/src/modules/identity/identity";
import { logoutAction } from "@/app/actions";

export default async function SeekerLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessAdmin(user) && !canAccessSeekerApp(user)) redirect("/onboard?add=seeker");

  return (
    <div className="seeker-scope app-shell">
      <main className="app-shell-main">{children}</main>
      <nav className="app-shell-bottom-nav" aria-label="Primary">
        <Link href="/seeker/dashboard">Home</Link>
        <Link href="/seeker/insiders">Insiders</Link>
        <Link href="/seeker/requests">Requests</Link>
        <Link href="/seeker/profile">Profile</Link>
        <form action={logoutAction}>
          <button type="submit">Log out</button>
        </form>
      </nav>
    </div>
  );
}
```

- [ ] **Step 8: Run and verify it passes**

Run: `npx vitest run app/seeker/layout.test.tsx`
Expected: PASS, all tests in the file green.

- [ ] **Step 9: Write the failing tests for the Insider layout**

Replace the contents of `app/insider/layout.test.tsx` with:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});
vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
}));

const getCurrentUserMock = vi.fn();
vi.mock("@/src/lib/current-user", () => ({
  getCurrentUser: () => getCurrentUserMock(),
}));

import InsiderLayout from "./layout";

describe("InsiderLayout", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    getCurrentUserMock.mockReset();
  });

  it("redirects to /login when there is no session", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    await expect(InsiderLayout({ children: <p>Inbox content</p> })).rejects.toThrow("REDIRECT:/login");
  });

  it("redirects to /onboard?add=insider when signed in with no Insider profile at all", async () => {
    getCurrentUserMock.mockResolvedValue({ userId: "u1", role: "seeker", seekerProfileId: "sp1", insiderProfile: null });
    await expect(InsiderLayout({ children: <p>Inbox content</p> })).rejects.toThrow("REDIRECT:/onboard?add=insider");
  });

  it("redirects to bare /onboard (resuming the OTP step) when the Insider profile exists but is unverified", async () => {
    getCurrentUserMock.mockResolvedValue({
      userId: "u1",
      role: "insider",
      seekerProfileId: null,
      insiderProfile: { id: "ip1", verifiedAt: null },
    });
    await expect(InsiderLayout({ children: <p>Inbox content</p> })).rejects.toThrow("REDIRECT:/onboard");
    expect(redirectMock).toHaveBeenCalledWith("/onboard");
  });

  it("renders the shell for a verified Insider", async () => {
    getCurrentUserMock.mockResolvedValue({
      userId: "u1",
      role: "insider",
      seekerProfileId: null,
      insiderProfile: { id: "ip1", verifiedAt: new Date() },
    });
    const element = await InsiderLayout({ children: <p>Inbox content</p> });
    render(element);
    expect(screen.getByText("Inbox content")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
  });

  it("renders the shell for an admin even with no Insider profile", async () => {
    getCurrentUserMock.mockResolvedValue({ userId: "admin-1", role: "admin", seekerProfileId: null, insiderProfile: null });
    const element = await InsiderLayout({ children: <p>Inbox content</p> });
    render(element);
    expect(screen.getByText("Inbox content")).toBeInTheDocument();
  });
});
```

- [ ] **Step 10: Run and verify it fails**

Run: `npx vitest run app/insider/layout.test.tsx`
Expected: FAIL — same reason as Step 6, for the Insider layout.

- [ ] **Step 11: Implement the Insider layout**

Replace the contents of `app/insider/layout.tsx` with:

```tsx
import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/src/lib/current-user";
import { canAccessAdmin, canAccessInsiderApp } from "@/src/modules/identity/identity";
import { logoutAction } from "@/app/actions";

export default async function InsiderLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessAdmin(user) && !canAccessInsiderApp(user)) {
    redirect(user.insiderProfile !== null ? "/onboard" : "/onboard?add=insider");
  }

  return (
    <div className="insider-scope app-shell">
      <main className="app-shell-main">{children}</main>
      <nav className="app-shell-bottom-nav" aria-label="Primary">
        <Link href="/insider/dashboard">Home</Link>
        <Link href="/insider/requests">Inbox</Link>
        <Link href="/insider/rewards">Rewards</Link>
        <Link href="/insider/profile">Profile</Link>
        <form action={logoutAction}>
          <button type="submit">Log out</button>
        </form>
      </nav>
    </div>
  );
}
```

- [ ] **Step 12: Run and verify it passes**

Run: `npx vitest run app/insider/layout.test.tsx`
Expected: PASS, all tests in the file green.

- [ ] **Step 13: Write the failing tests for the Admin layout**

Replace the contents of `app/(admin)/admin/layout.test.tsx` with:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});
const notFoundMock = vi.fn(() => {
  throw new Error("NOT_FOUND");
});
vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
  notFound: () => notFoundMock(),
}));

const getCurrentUserMock = vi.fn();
vi.mock("@/src/lib/current-user", () => ({
  getCurrentUser: () => getCurrentUserMock(),
}));

import AdminLayout from "./layout";

describe("AdminLayout", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    notFoundMock.mockClear();
    getCurrentUserMock.mockReset();
  });

  it("redirects to /login when there is no session", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    await expect(AdminLayout({ children: <p>Requests queue</p> })).rejects.toThrow("REDIRECT:/login");
  });

  it("calls notFound() for a signed-in non-admin, never revealing the route exists via a redirect", async () => {
    getCurrentUserMock.mockResolvedValue({ userId: "u1", role: "seeker", seekerProfileId: "sp1", insiderProfile: null });
    await expect(AdminLayout({ children: <p>Requests queue</p> })).rejects.toThrow("NOT_FOUND");
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("renders the shell for an admin", async () => {
    getCurrentUserMock.mockResolvedValue({ userId: "admin-1", role: "admin", seekerProfileId: null, insiderProfile: null });
    const element = await AdminLayout({ children: <p>Requests queue</p> });
    render(element);
    expect(screen.getByText("Requests queue")).toBeInTheDocument();
  });
});
```

- [ ] **Step 14: Run and verify it fails**

Run: `npx vitest run "app/(admin)/admin/layout.test.tsx"`
Expected: FAIL — same reason as Step 6, for the Admin layout.

- [ ] **Step 15: Implement the Admin layout**

Replace the contents of `app/(admin)/admin/layout.tsx` with:

```tsx
import type { ReactNode } from "react";
import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/src/lib/current-user";
import { canAccessAdmin } from "@/src/modules/identity/identity";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessAdmin(user)) notFound();

  return <div className="admin-shell">{children}</div>;
}
```

- [ ] **Step 16: Run the whole guarded-layout test suite and typecheck**

Run: `npx vitest run app/actions.test.ts app/seeker/layout.test.tsx app/insider/layout.test.tsx "app/(admin)/admin/layout.test.tsx" && npm run typecheck`
Expected: all green, no type errors.

- [ ] **Step 17: Commit**

```bash
git add app/actions.ts app/actions.test.ts app/seeker/layout.tsx app/seeker/layout.test.tsx app/insider/layout.tsx app/insider/layout.test.tsx "app/(admin)/admin/layout.tsx" "app/(admin)/admin/layout.test.tsx"
git commit -m "feat(layouts): guard the three app shells with real session checks, add logoutAction"
```

---

## Task 4: Placeholder dashboards

**Files:**
- Create: `app/seeker/dashboard/page.tsx`
- Create: `app/seeker/dashboard/page.test.tsx`
- Create: `app/insider/dashboard/page.tsx`
- Create: `app/insider/dashboard/page.test.tsx`
- Create: `app/(admin)/admin/page.tsx`
- Create: `app/(admin)/admin/page.test.tsx`

**Interfaces:**
- Consumes: `getCurrentUser` (`@/src/lib/current-user`).
- Produces: three minimal pages — a heading and "Signed in as {userId}" — enough for the guarded layouts (Task 3) and the browser E2E test (Task 5) to land somewhere real. Full dashboards are out of scope (AGENTS.md Phase 1 backlog item, tracked separately).

- [ ] **Step 1: Write the failing tests**

Create `app/seeker/dashboard/page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getCurrentUserMock = vi.fn();
vi.mock("@/src/lib/current-user", () => ({
  getCurrentUser: () => getCurrentUserMock(),
}));

import SeekerDashboardPage from "./page";

describe("SeekerDashboardPage", () => {
  beforeEach(() => {
    getCurrentUserMock.mockReset();
  });

  it("renders a heading and the signed-in user's id", async () => {
    getCurrentUserMock.mockResolvedValue({ userId: "u1", role: "seeker", seekerProfileId: "sp1", insiderProfile: null });
    const element = await SeekerDashboardPage();
    render(element);
    expect(screen.getByRole("heading", { name: "Seeker dashboard" })).toBeInTheDocument();
    expect(screen.getByText(/u1/)).toBeInTheDocument();
  });
});
```

Create `app/insider/dashboard/page.test.tsx` (identical shape, Insider copy):

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getCurrentUserMock = vi.fn();
vi.mock("@/src/lib/current-user", () => ({
  getCurrentUser: () => getCurrentUserMock(),
}));

import InsiderDashboardPage from "./page";

describe("InsiderDashboardPage", () => {
  beforeEach(() => {
    getCurrentUserMock.mockReset();
  });

  it("renders a heading and the signed-in user's id", async () => {
    getCurrentUserMock.mockResolvedValue({
      userId: "u1",
      role: "insider",
      seekerProfileId: null,
      insiderProfile: { id: "ip1", verifiedAt: new Date() },
    });
    const element = await InsiderDashboardPage();
    render(element);
    expect(screen.getByRole("heading", { name: "Insider dashboard" })).toBeInTheDocument();
    expect(screen.getByText(/u1/)).toBeInTheDocument();
  });
});
```

Create `app/(admin)/admin/page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getCurrentUserMock = vi.fn();
vi.mock("@/src/lib/current-user", () => ({
  getCurrentUser: () => getCurrentUserMock(),
}));

import AdminIndexPage from "./page";

describe("AdminIndexPage", () => {
  beforeEach(() => {
    getCurrentUserMock.mockReset();
  });

  it("renders a heading and the signed-in admin's id", async () => {
    getCurrentUserMock.mockResolvedValue({ userId: "admin-1", role: "admin", seekerProfileId: null, insiderProfile: null });
    const element = await AdminIndexPage();
    render(element);
    expect(screen.getByRole("heading", { name: "Admin" })).toBeInTheDocument();
    expect(screen.getByText(/admin-1/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run and verify they fail**

Run: `npx vitest run app/seeker/dashboard/page.test.tsx app/insider/dashboard/page.test.tsx "app/(admin)/admin/page.test.tsx"`
Expected: FAIL — none of the three `./page` modules exist yet.

- [ ] **Step 3: Implement**

Create `app/seeker/dashboard/page.tsx`:

```tsx
import { getCurrentUser } from "@/src/lib/current-user";

export default async function SeekerDashboardPage() {
  const user = await getCurrentUser();
  return (
    <div>
      <h1>Seeker dashboard</h1>
      <p>Signed in as {user?.userId}</p>
    </div>
  );
}
```

Create `app/insider/dashboard/page.tsx`:

```tsx
import { getCurrentUser } from "@/src/lib/current-user";

export default async function InsiderDashboardPage() {
  const user = await getCurrentUser();
  return (
    <div>
      <h1>Insider dashboard</h1>
      <p>Signed in as {user?.userId}</p>
    </div>
  );
}
```

Create `app/(admin)/admin/page.tsx`:

```tsx
import { getCurrentUser } from "@/src/lib/current-user";

export default async function AdminIndexPage() {
  const user = await getCurrentUser();
  return (
    <div>
      <h1>Admin</h1>
      <p>Signed in as {user?.userId}</p>
    </div>
  );
}
```

- [ ] **Step 4: Run and verify they pass, then typecheck**

Run: `npx vitest run app/seeker/dashboard/page.test.tsx app/insider/dashboard/page.test.tsx "app/(admin)/admin/page.test.tsx" && npm run typecheck`
Expected: all green, no type errors.

- [ ] **Step 5: Commit**

```bash
git add app/seeker/dashboard app/insider/dashboard "app/(admin)/admin/page.tsx" "app/(admin)/admin/page.test.tsx"
git commit -m "feat(dashboards): add placeholder Seeker/Insider/Admin dashboard pages"
```

---

## Task 5: Browser-driven Playwright test

**Files:**
- Create: `playwright.browser.config.ts`
- Create: `tests/e2e-browser/auth-onboarding.spec.ts`
- Modify: `package.json` (add `test:e2e:browser` script)

**Interfaces:**
- Consumes: the whole flow built in Tasks 1–4, plus Plan A's `createFileMailboxEmailSender` (indirectly, via `DEV_MAILBOX_PATH`) and the seeded `acme.com` company (`scripts/seed.ts`).
- Produces: a real, browser-driven Playwright config and spec — the first in this repo — isolated from the existing module-driven `tests/e2e/**` suite (own `testDir`, own `webServer`, no shared `globalSetup`).

- [ ] **Step 1: Add the isolated Playwright config**

Create `playwright.browser.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const MAILBOX_PATH = path.join(process.cwd(), ".playwright-mailbox.jsonl");

export default defineConfig({
  testDir: "./tests/e2e-browser",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:3100",
  },
  webServer: {
    command: "npm run dev -- -p 3100",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      NODE_ENV: "development",
      ADAPTERS: "real",
      DEV_LOGIN_ENABLED: "true",
      DEV_MAILBOX_PATH: MAILBOX_PATH,
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
```

This file has no `globalSetup` (unlike `playwright.config.ts`) — each test seeds the exact state it needs directly, and there is nothing here to isolate the existing suite from, since this config's `webServer`/env are entirely separate from `tests/e2e/**`'s.

- [ ] **Step 2: Add the test spec**

Create `tests/e2e-browser/auth-onboarding.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

const MAILBOX_PATH = path.join(process.cwd(), ".playwright-mailbox.jsonl");
const tag = Date.now().toString(36);

function readLatestOtpCode(workEmail: string): string {
  const lines = readFileSync(MAILBOX_PATH, "utf8").trim().split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const msg = JSON.parse(lines[i]) as { to: string; html: string };
    if (msg.to === workEmail) {
      const match = msg.html.match(/\d{6}/);
      if (match) return match[0];
    }
  }
  throw new Error(`No OTP email found for ${workEmail}`);
}

test.describe("auth and onboarding", () => {
  test("new Seeker signs in and lands on /seeker/dashboard", async ({ page }) => {
    const email = `seeker-${tag}-1@example.com`;
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Code").fill("000000");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/onboard/);
    await page.getByRole("button", { name: "I'm looking for a job" }).click();
    await page.getByLabel("Full name").fill("Playwright Seeker");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/seeker\/dashboard/);
  });

  test("new Insider signs in, verifies a work email via the dev mailbox, and lands on /insider/dashboard", async ({ page }) => {
    const loginEmail = `insider-${tag}-1@example.com`;
    const workEmail = `insider-${tag}-1@acme.com`;
    await page.goto("/login");
    await page.getByLabel("Email").fill(loginEmail);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Code").fill("000000");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/onboard/);
    await page.getByRole("button", { name: "I'm an Insider" }).click();
    await page.getByLabel("Full name").fill("Playwright Insider");
    await page.getByLabel("Work email").fill(workEmail);
    await page.getByRole("button", { name: "Send code" }).click();
    await expect(page.getByLabel("Code")).toBeVisible();

    const code = readLatestOtpCode(workEmail);
    await page.getByLabel("Code").fill(code);
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page).toHaveURL(/\/insider\/dashboard/);
  });

  test("a returning user signs in and lands directly on their dashboard, skipping /onboard", async ({ page }) => {
    const email = `returning-${tag}-1@example.com`;

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Code").fill("000000");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("button", { name: "I'm looking for a job" }).click();
    await page.getByLabel("Full name").fill("Returning Seeker");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/seeker\/dashboard/);

    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/^http:\/\/localhost:3100\/$/);

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Code").fill("000000");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/seeker\/dashboard/);
  });

  test("a signed-out visit to /seeker/dashboard redirects to /login", async ({ page }) => {
    await page.goto("/seeker/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });
});
```

- [ ] **Step 3: Add the npm script**

In `package.json`, add to `"scripts"` (after the existing `"test:e2e": "playwright test",` line):

```json
    "test:e2e:browser": "playwright test --config=playwright.browser.config.ts",
```

- [ ] **Step 4: Run it against a real dev Postgres**

This test needs a running, migrated, seeded dev Postgres — the same one `tests/e2e/**` already uses. Run:

```bash
docker compose -f infra/compose.dev.yml up -d
npm run db:migrate
npm run db:seed
npm run test:e2e:browser
```

Expected: all 4 tests pass. If `acme.com` isn't seeded (fresh database), `npm run db:seed` seeds it — `scripts/seed.ts`'s `PLACEHOLDER_COMPANIES` list seeds Acme Technologies with domain `acme.com` first, which is what the Insider test signs up against.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors — `playwright.browser.config.ts` and `tests/e2e-browser/auth-onboarding.spec.ts` are picked up by the existing `**/*.ts` include pattern in `tsconfig.json`.

- [ ] **Step 6: Commit**

```bash
git add playwright.browser.config.ts tests/e2e-browser package.json
git commit -m "test(e2e): add the first browser-driven Playwright test, covering sign-in and onboarding for both roles"
```

---

## Completion

After Task 5, the full slice is live: a person can open `/login`, sign in, get routed through `/onboard` for their role, land on a real (if minimal) dashboard, and every one of the three app shells actually enforces who can be there — none of that was true before this plan. Run `npm run lint && npm run typecheck && npm test` once more, and separately run `npm run test:e2e:browser` against a seeded dev Postgres per Task 5 Step 4, and paste both outputs in the final report.

Screenshots for AGENTS.md §4.7's frontend definition-of-done (390px and 1280px) should be taken of `/login` and `/onboard` (role-choice step) once `npm run dev` is running locally, and attached to the task report.
