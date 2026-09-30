# Auth, Session Guards, and Onboarding — Design

Date: 2026-09-30. Status: draft for founder review (design confirmed by opus acting as solution architect, per standing delegation). Sources: `AGENTS.md` Part 4 in full, Part 1.5, §3.2, §3.6, Part 7; `USER-FLOWS.md` §3-4; `SESSION-HANDOFF.md` §0/§3.

## 1. Goal

The first real screens in the project: `/login`, `/onboard`, and session-reading guards for `app/seeker`, `app/insider`, `app/(admin)/admin`. Every backend module built so far (identity, insiders, requests, proof, notifications, rewards) has zero UI in front of it — this is what makes any of it reachable by a person.

## 2. Decisions already made, not reopened here

1. **`/login` in fake mode keeps the real flow's two-step shape** (email → OTP), rather than collapsing to one field, so real Firebase later is a pure backend swap and a browser E2E test can drive it meaningfully (founder-approved).
2. **This spec covers two plans, run in order**, decided by opus acting as solution architect after finding the original one-task draft had real security and missing-piece gaps (detailed in §3-§4 below, which supersede that draft):
   - **Plan A — backend: auth plumbing and gates.** Environment gating, adapter-level production safety, identity module additions, DB reads, rate limiting, `problems.ts`. Testable with no UI.
   - **Plan B — frontend: login, onboard, and guarded shells.** Pages, server actions, layouts, component tests, and the first browser-driven Playwright test in the repo. Built on Plan A.

## 3. What the original draft got wrong (recorded so it isn't repeated)

- **`ADAPTERS === "fake"` fails open.** `env.ts` defaults `ADAPTERS` to `"fake"`; a production deploy that omits the variable gets dev login by default.
- **`ADAPTERS` is the wrong axis regardless of the default.** `adapters.impl.ts` (confirmed by reading it) wires the fake auth adapter **unconditionally** — `auth: createFakeAuthAdapter().adapter`, no `ADAPTERS` check at all. Every environment today accepts a forged token; hiding a page never closes that.
- **Nothing sends or retrieves the Insider OTP email.** `adapters.impl.ts`'s `getAdapters()` keeps only `createFakeEmailSender().sender`, discarding the `.sent` array the fake also returns — every emailed code is currently unrecoverable, blocking both manual testing and a browser E2E.
- **No way to look up a profile by `userId`.** `Database.identity` (confirmed in `src/adapters/db/types.ts`) has no `getSeekerProfileByUserId`/`getInsiderProfileByUserId` — the app cannot tell a new user from a returning one, or check `verifiedAt` from a session alone.
- **Layout-only guards are not enforcement.** Per the Next 16 docs shipped in this repo (`node_modules/next/dist/docs/01-app/02-guides/authentication.md`), layouts don't re-render on client-side navigation and server actions are separate entry points. Every mutating server action must independently re-derive and check the current user; a layout redirect is UX, not the security boundary.

## 4. Design

### 4.1 Environment gating (Plan A)

- `src/config/env.ts` gains `DEV_LOGIN_ENABLED: z.boolean().default(false)`, with a Zod `.refine()` (or a post-parse check in `getEnv()`) that fails boot if `DEV_LOGIN_ENABLED` is `true` and `NODE_ENV === "production"`. The Dockerfile already sets `NODE_ENV=production`, so no built image can carry a `true` value into production even if the env var leaks in.
- `adapters.impl.ts`'s `auth` selection changes from unconditional-fake to: real Firebase adapter when one exists (not yet — out of scope), else, **when `NODE_ENV === "production"`, an adapter whose `verifyIdToken` always throws `InvalidTokenError`** (closing the forged-token path at its source, independent of any page or flag), else the fake adapter as today. This is the actual security fix; §4.7's page-level check is defense in depth on top of it, not the primary control.

### 4.2 Identity module additions (Plan A) — `src/modules/identity/identity.ts`

All new functions take the existing `IdentityDeps` (`{ db, auth }`) or a narrower `{ db }`/`{ db, email }` slice, matching this file's existing style (no Next.js, no Drizzle, no vendor SDK imports).

- `getSessionUser(deps: { db: Database }, userId: string): Promise<SessionUser | null>` where
  ```ts
  export interface SessionUser {
    userId: string;
    role: Role;
    seekerProfileId: string | null;
    insiderProfile: { id: string; verifiedAt: Date | null } | null;
  }
  ```
  Returns `null` if the user no longer exists (deleted/revoked). This re-derives role and profile state fresh on every call — no caching of role in the cookie is trusted for authorization (see §4.4 for why a DB read wins over re-issuing the cookie at the moment of promotion: the Insider guard needs `verifiedAt`, which the cookie never carries and which must eventually go stale on its own 90-day re-verification cadence anyway; an admin role change or account deletion must also take effect on the next request, not after 30 days; this matches the existing codebase rule that jobs "re-check current state before acting" rather than trust a stored snapshot).
- `createSeekerProfile(deps: { db: Database }, userId: string, fullName: string): Promise<SeekerProfileRecord>` — **idempotent**: if a seeker profile already exists for `userId` (the unique index `seeker_profiles_user_id_idx` already enforces this at the DB level), return the existing row instead of a duplicate-key error, so a double form submit is harmless. (`Database.identity.createSeekerProfile` — the raw DB method — stays a plain insert; the module function adds the find-or-return wrapper, the same shape `findOrCreateInsiderProfile` already has at the DB layer.)
- `requestWorkEmailOtp(deps: { db: Database; email: EmailSender }, userId: string, workEmail: string): Promise<{ insiderProfileId: string }>` — calls the existing `startWorkEmailOtp` (still exported, unchanged), then renders and sends a minimal OTP email to `workEmail` via `EmailSender.send` (synchronous — the user is waiting on this screen; the notifications module's `notify()` doesn't fit here, since it always sends to `user.email`, not a work address that may differ). Returns only `{ insiderProfileId }` — the code itself is never returned to the caller (the existing `StartWorkEmailOtpResult`'s own doc comment already says this; this function is the thing that actually honors it by sending instead of handing the code back up the call stack).
- `verifyWorkEmailOtpForUser(deps: { db: Database }, userId: string, code: string): Promise<boolean>` — resolves the Insider profile from `userId` (via the new `getInsiderProfileByUserId`, §4.3) rather than taking a caller-supplied `insiderProfileId`, then calls the existing `verifyWorkEmailOtp`. This closes an ownership gap the original draft had: a server action must never accept `insiderProfileId` from client input, since nothing stopped one user from verifying with another user's profile id.
- `resolveLanding(user: SessionUser): "/onboard" | "/seeker/dashboard" | "/insider/dashboard"` — pure function, no `deps`, single source of truth for "where does a signed-in user go" — used by `/login`'s post-sign-in redirect, `/onboard`'s already-onboarded redirect, and both app layouts' guard logic, so the three call sites can never drift into different rules. Logic: no seeker profile and no verified insider profile → `/onboard`; else prefer landing in whichever app the user most recently has access to — for this slice (role is never assigned as bare `"insider"`, only promoted `seeker → both`, confirmed by reading `identity.ts`), a `both`-role user with both profiles lands on `/seeker/dashboard` by default (the seeker app is the more common entry path per `AGENTS.md`'s own framing of the product).

### 4.3 DB layer additions (Plan A) — `src/adapters/db/types.ts`, `fake.ts`, `real.ts`

- `getSeekerProfileByUserId(userId: string): Promise<SeekerProfileRecord | null>`
- `getInsiderProfileByUserId(userId: string): Promise<InsiderProfileRecord | null>`
- `storeWorkEmailOtp` gains the behavior (not a signature change) of invalidating any earlier unconsumed code for the same `insiderProfileId` before storing the new one — today a resend leaves multiple simultaneously-valid codes with no attempt limit; this closes the easy half of that gap (the other half, rate limiting, is §4.6).
- Contract tests for both new reads (fake and real, matching this codebase's adapter-contract-test convention), and a fake/real parity test for the OTP-invalidation behavior.

### 4.4 Session freshness — `src/lib/current-user.ts` (Plan A)

A new `server-only` module: decodes the session cookie (via the existing, unchanged `getSessionFromCookies` in `src/lib/session.ts`), then calls `identity.getSessionUser`, wrapped in React's `cache()` so multiple reads within one request/render tree share one DB round-trip rather than one per component. The cookie itself is reduced to an identity carrier (`userId`, `issuedAt`) — its `role` field is written for backward compatibility with `SessionPayload`'s existing shape but is **never read for authorization**; every caller uses the fresh `SessionUser` from this module instead. `src/lib/authorize.ts`'s signature is unchanged; callers now pass it `{ userId, role }` sourced from the fresh `SessionUser`, never the raw cookie payload.

### 4.5 `problems.ts` (Plan A) — new, minimal, `src/lib/problems.ts`

First real consumer of the RFC-7807-flavored pattern `AGENTS.md` §4.4/§2.7 describes. Scoped tightly to what this slice can raise — do not build the general HTTP `application/problem+json` serializer yet (no `/api/v1` route exists to need it):

```ts
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
```
A small `mapErrorToProblem(err: unknown): Problem` function in the same file translates the identity module's thrown error classes (`WorkEmailDomainError`, `InsiderCompanyChangeError`, `InvalidTokenError`) plus the two boolean-returning-false cases (`verifyWorkEmailOtpForUser` returning `false`, dev-login's fixed-code check failing) into this shape. **Copy is written fresh here, in human language — `WorkEmailDomainError.message` is developer text that quotes the raw domain string and is never rendered directly** (AGENTS.md §4.6: "error copy is human, never a Zod message" extends to domain-error messages too). Every server action in this slice returns `{ ok: true } | { ok: false; problem: Problem }` per AGENTS.md §4.4.

### 4.6 Rate limiting (Plan A)

Using the existing `src/lib/ratelimit.ts` (`createInMemoryRateLimiter`, already built, currently unused anywhere): one limiter instance each for dev-login attempts, OTP send, and OTP verify, keyed by a combination of the acting `userId` (once known) and IP where available. Deliberately in-memory/single-replica for now, matching `AGENTS.md` §3.5's own stated interim design ("in-process token bucket... interface allows a Redis implementation later").

### 4.7 `/login` (Plan B) — `app/(public)/login/page.tsx` + `actions.ts`

Two-step UI (email → 6-digit code), gated by `env.DEV_LOGIN_ENABLED && process.env.NODE_ENV !== "production"` checked **independently in both the page (returns `notFound()` if not enabled) and the server action (rejects with a `Problem`)** — never inferred from the UI being hidden. The action:
```ts
async function devLoginAction(input: { email: string; code: string }): Promise<ActionResult>
```
validates with Zod, checks the rate limiter, checks `code === "000000"` (the fixed dev code — this exact string, and **only** inside this action; it must never be accepted by the work-email OTP path in `verifyWorkEmailOtpForUser`, which is a separate, unrelated code space), derives `providerUid` deterministically as `` `dev:${email.toLowerCase()}` `` (so the same email always signs back in as the same user — the action never takes a client-supplied ID token), builds the fake identity token server-side, calls `signInWithFirebaseToken`, sets the session cookie, and redirects via `resolveLanding`. "Continue with Google" is out of scope (no fake equivalent makes sense; arrives with real Firebase).

### 4.8 `/logout` (Plan B)

One server action: `clearSessionCookie()`, redirect to `/`.

### 4.9 `/onboard` (Plan B) — `app/(public)/onboard/page.tsx` + `actions.ts`

Access: signed in (else `/login`); already fully onboarded → `resolveLanding`'s result. **The starting step is derived from server state, not client state** (so a reload or a direct link never loses progress): no profiles at all → role-choice step; an unverified Insider profile exists → resume at the OTP-entry step (with "Resend code" and "Use a different email" actions, both re-running `requestWorkEmailOtp`); a Seeker profile exists and the user is now adding the Insider role → Insider name+email step directly.

- **Role choice step:** client component, existing `Chip`/`Card` primitives, no data — routes to 2a or 2b.
- **2a, Seeker:** `fullName` field → action → `createSeekerProfile(deps, currentUser.userId, fullName)` (idempotent) → redirect `/seeker/dashboard`.
- **2b, Insider:** `fullName` + `workEmail` fields → action → `requestWorkEmailOtp(deps, currentUser.userId, workEmail)`; an unresolved domain shows `mapErrorToProblem`'s human copy for `work-email-domain-not-registered` inline, not a generic failure → OTP-entry step (single 6-digit field, `autocomplete="one-time-code"`, `inputmode="numeric"`) → action → `verifyWorkEmailOtpForUser(deps, currentUser.userId, code)` → on success, redirect `/insider/dashboard`; on failure, `otp-invalid-or-expired` inline.
- Every action: Zod parse → `current-user.ts`'s fresh user (never a client-supplied id) → `authorize()` → exactly one module call → redirect or `revalidatePath`.

### 4.10 Layout guards (Plan B)

`app/seeker/layout.tsx`, `app/insider/layout.tsx`, `app/(admin)/admin/layout.tsx` each become `async` server components calling `current-user.ts`:

- No session → redirect `/login`.
- **Seeker app:** role is `seeker` or `both` AND a seeker profile exists → render; no seeker profile → redirect `/onboard`.
- **Insider app:** role is `both` (role is never assigned as bare `"insider"` today — confirmed in `identity.ts`; the spec still checks `insider` too, for whenever that changes) AND an insider profile exists AND `verifiedAt` is set → render; profile exists but unverified → redirect `/onboard` (resumes at the OTP step per §4.9); no insider profile at all → redirect `/seeker/dashboard` (don't send someone with no insider intent into onboarding for a role they never chose).
- **Admin:** role is `admin` → render; else `notFound()` (the admin console is never advertised to a non-admin, not even via a redirect that reveals it exists).
- **Loop check, explicit:** an Insider-first user who becomes `both` with no Seeker profile must be sent to `/onboard`'s Seeker step by the Seeker layout guard, and `/onboard` itself must not immediately bounce that same user back out via `resolveLanding` — `resolveLanding`'s "no seeker profile and no verified insider profile → `/onboard`" rule already covers this (a `both`-role user with a verified Insider profile but no Seeker profile still has "no seeker profile", so `resolveLanding` keeps sending them to `/onboard`, and `/onboard`'s own step-derivation in §4.9 puts them straight at the Seeker name step, not back at role choice).
- Every action still independently checks the current user per §3/§4.9 — layouts are UX, not the enforcement boundary.

### 4.11 Fake email dev-mailbox (Plan A, needed by Plan B's tests)

`createFakeEmailSender` is unchanged. `adapters.impl.ts` keeps its `.sent` array reachable (not discarded) when `process.env.NODE_ENV !== "production"`, written to a location a browser-driven Playwright test can read — a `DEV_MAILBOX_DIR` env var pointing at a JSON file the fake sender appends to, read by the test between the OTP-request step and OTP-entry step. Never logged (AGENTS.md §2.6/§2.7 — OTP codes are exactly the kind of secret-shaped data that must not hit logs), never exposed by any page or API route — filesystem-only, opt-in via the env var, and that var must be unset/ignored when `NODE_ENV === "production"` (same production-safety treatment as `DEV_LOGIN_ENABLED`).

### 4.12 Design constraints (from AGENTS.md Part 4, applies to Plan B)

Tokens only, no arbitrary Tailwind values. `/login` and `/onboard` live in `app/(public)`, default `.seeker-scope`; the Insider step of onboarding switches to `.insider-scope` so `var(--primary)` changes accordingly. Forms max-width 680px, mobile-first at 390px; screenshots attached at 390px and 1280px per the frontend definition-of-done. Labelled inputs, focus-visible styles, 4.5:1 contrast. Locked vocabulary: "Insider", "Seeker", "Get vouched in" (never "Get referred"); brand name from `src/config/brand.ts`, never hardcoded.

## 5. Testing

**Plan A (unit, no UI, matches this codebase's existing fake-adapter test convention):**
- `getSessionUser` and the layout access-rule logic (extracted as pure decision functions so they're testable without rendering) — every role/profile/verified-state combination, including every denial case, per AGENTS.md §3.6.
- The `DEV_LOGIN_ENABLED`-in-production boot failure.
- The production auth adapter rejecting every token.
- `createSeekerProfile` idempotency (double-submit test).
- `requestWorkEmailOtp` sending via the fake `EmailSender` and the OTP-invalidation-on-resend behavior.
- `verifyWorkEmailOtpForUser` resolving from `userId`, never trusting a caller-supplied profile id.
- Rate-limit denial paths for all three limiters.
- `resolveLanding` for every `SessionUser` shape.
- `mapErrorToProblem` for every listed error class.

**Plan B:**
- Component tests for the onboarding step components (state transitions, inline validation) using Testing Library, per the existing `components/ui/*.test.tsx` convention.
- Server-action tests against fake adapters (existing convention) for `/login`'s dev-login action and every `/onboard` action.
- **First browser-driven Playwright test in the repo** (everything in `tests/e2e/` so far drives module functions directly — no UI existed until this plan): run with `ADAPTERS=real` (real dev Postgres, so seeded companies exist) and `DEV_LOGIN_ENABLED=true`, Playwright's own `webServer` config launching `next dev`, `workers: 1` preserved (do not start a second `notify.send` consumer). Flows: new Seeker sign-in → lands on `/seeker/dashboard`; new Insider sign-in → OTP `000000` for dev-login, then a real work-email OTP retrieved from the dev mailbox sink → lands on `/insider/dashboard`; returning user signs in → lands directly on their dashboard, skips `/onboard`; a signed-out visit to `/seeker/dashboard` redirects to `/login`.

## 6. Risks and follow-ups

- Real Firebase (web SDK, Admin adapter, Google sign-in) is deliberately deferred; when it lands, only `/login`'s action and `adapters.impl.ts`'s auth selection change — no other file in this spec should need to.
- The visible role-switcher widget and its cookie are explicitly out of scope; `resolveLanding` already picks a sensible default for `both`-role users without it.
- `problems.ts` stays deliberately narrow to this slice's errors; widen it per-feature as later screens need it, not preemptively.
- OTP abuse controls here are a minimum (rate limit + single-active-code); a persistent per-profile attempt counter is a reasonable future hardening, not required now.
- `/for-insiders` (the public landing page `USER-FLOWS.md` §3 describes as `/onboard`'s natural entry point) is not built in this spec; `/onboard` must still work when reached directly.
