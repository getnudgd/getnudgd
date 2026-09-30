# Auth, Session Guards, and Onboarding — Design

Date: 2026-09-30 (revised twice after opus reviews of this written spec: the second pass fixed a type collision and a self-contradictory landing/onboarding rule; a third pass — recorded in §3 — fixed a residual landing-priority bug the second pass introduced, plus four smaller signature/isolation gaps). Status: draft for founder review. Sources: `AGENTS.md` Part 4 in full, Part 1.5, §3.2, §3.6, Part 7; `USER-FLOWS.md` §3-4; `SESSION-HANDOFF.md` §0/§3.

## 1. Goal

The first real screens in the project: `/login`, `/onboard`, and session-reading guards for `app/seeker`, `app/insider`, `app/(admin)/admin`. Every backend module built so far (identity, insiders, requests, proof, notifications, rewards) has zero UI in front of it — this is what makes any of it reachable by a person.

## 2. Decisions already made, not reopened here

1. **`/login` in fake mode keeps the real flow's two-step shape** (email → OTP), rather than collapsing to one field, so real Firebase later is a pure backend swap and a browser E2E test can drive it meaningfully.
2. **Two plans, run in order**, opus's own recommendation:
   - **Plan A — backend: auth plumbing, gates, and every decision function.** Environment gating, adapter-level production safety, identity module additions, DB reads, rate limiters, `problems.ts`, and — per the revision below — the layout access-rule logic itself as named, pure, independently-testable functions. Nothing in Plan A needs a page to test.
   - **Plan B — frontend: pages, actions, and guarded shells.** Pages, server actions, layouts that call Plan A's functions, component tests, placeholder dashboard pages, and the first browser-driven Playwright test in the repo. Plan B calls Plan A; it never contains its own decision logic.

## 3. What earlier review passes caught (recorded so it isn't repeated)

**First pass (in-chat design, before any spec existed):** the `ADAPTERS === "fake"` gate fails open (defaults to `"fake"`); `adapters.impl.ts` wires the fake auth adapter unconditionally regardless of `ADAPTERS`, so every environment today accepts a forged token; nothing sends or retrieves the Insider OTP email; no way to look up a profile by `userId`; layout-only guards aren't real enforcement in Next 16 (server actions are separate entry points and must independently check).

**Second pass (this written spec, before any plan existed):**
- **`SessionUser` name collision.** `src/modules/identity/identity.ts` already exports `SessionUser { userId; role }`, returned by `signInWithFirebaseToken`. The first spec draft silently redefined `SessionUser` with extra fields. **Fixed below by naming the new, richer type `CurrentUser` and leaving `SessionUser` untouched.**
- **The landing/onboarding logic was actually self-contradictory**, not just underspecified: the "loop check" claimed a rule it misquoted, and as a result there was no defined destination for a verified Insider with no Seeker profile, and no mechanism at all for a Seeker who wants to *add* the Insider role (the literal "Add Insider role" flow `USER-FLOWS.md` §4/§186 names). **Fixed below with an exhaustive `resolveLanding` table and an explicit `add` intent parameter.**
- **Several proposed signatures didn't type-check against the real code**: `env.ts`'s boolean parsing, `authorize()`'s parameter type, `startWorkEmailOtp`/`verifyWorkEmailOtp`'s required `IdentityDeps` shape, `createSeekerProfile`'s idempotency under real concurrency. **Fixed below, each called out at its section.**
- **Plan B's own E2E test needs pages that weren't in either plan's scope** (`/seeker/dashboard`, `/insider/dashboard`, `/admin` all currently 404). **Fixed: added as placeholder pages to Plan B's scope, §5.**

**Third pass (this written spec, revision of the revision):** a third opus review confirmed 9 of the 13 second-pass fixes held, and found the fix for the landing/onboarding rule itself introduced a new, real bug, plus four smaller gaps:
- **Landing-priority regression.** The second pass's `resolveLanding` table put the verified-Insider row ahead of the Seeker-profile row. This violated the original "both profiles → Seeker dashboard" requirement and, worse, meant a Seeker who started (but abandoned) adding the Insider role — leaving an unverified `insider_profiles` row behind — was routed to `/onboard` forever and could never reach `/seeker/dashboard` through the normal landing path. **Fixed below: the Seeker-profile row now comes before both Insider rows in `resolveLanding` (§4.2), with the reasoning recorded inline at the table.**
- **False "unchanged" signature claims.** `verifyWorkEmailOtp` was claimed to already take only `{ db }`; it actually requires full `IdentityDeps`, same as `startWorkEmailOtp`. **Fixed: both existing functions are now narrowed to `Pick<IdentityDeps, "db">` as a small Plan A edit, and the new wrapper functions just pass `deps` straight through — no internal `IdentityDeps` construction or `getAdapters()` call (which would have violated AGENTS §2.2).**
- **`limiterKey`'s signature took a `Request`**, which server actions never receive. **Fixed: takes `Headers` (from `next/headers`), and uses the first entry of a comma-separated `x-forwarded-for`.**
- **The proposed browser-E2E isolation ("separate Playwright project or testMatch glob") doesn't isolate anything** — `webServer` and `globalSetup` are top-level Playwright config, not per-project, so it would have started `next dev` with dev-only env vars and run the existing `global-setup.ts` on every Flow A/B/C run. **Fixed: a genuinely separate config file, `playwright.browser.config.ts`, with its own `testDir`, script, and no `globalSetup`.**
- A stray citation (`createRedemption` for the `ON CONFLICT` race-safety pattern) pointed at the wrong function. **Fixed: cites the actual pattern, the notifications insert at `src/adapters/db/real.ts:859`.**

## 4. Design

### 4.1 Environment gating (Plan A)

- `src/config/env.ts` gains `DEV_LOGIN_ENABLED: z.stringbool().default(false)` — **not** `z.boolean()` (which doesn't parse the string values `process.env` actually holds) and **not** `z.coerce.boolean()` (which treats the string `"false"` as truthy, since any non-empty string coerces to `true`). `z.stringbool()` exists in the installed zod v4 (confirmed: `node_modules/zod/v4/classic/schemas.d.ts`) and parses `"true"/"false"/"1"/"0"` correctly.
- A `.refine()` (or an explicit check inside `getEnv()`, alongside its existing `safeParse`) fails `getEnv()` — this is a lazy, first-call check, not a startup hook, since `getEnv()` itself is lazy (confirmed: it caches on first call, nothing calls it eagerly at process start) — if `DEV_LOGIN_ENABLED` is `true` and `NODE_ENV === "production"`. The Dockerfile already sets `NODE_ENV=production`, so no built image can carry a `true` value into a request path that ever calls `getEnv()`, which every request does.
- `adapters.impl.ts`'s `auth` selection changes from unconditional-fake to: real Firebase adapter when one exists (not yet — out of scope), else, **when `NODE_ENV === "production"`, an adapter whose `verifyIdToken` always throws `InvalidTokenError`**, else the fake adapter as today. **This is the primary security control.** §4.7's page/action-level `DEV_LOGIN_ENABLED` check is defense in depth on top of it, not the thing actually closing the forged-token path — that path is closed here, independent of any page, flag misconfiguration, or route existing at all.

### 4.2 Identity module additions (Plan A) — `src/modules/identity/identity.ts`

**`SessionUser` (existing, unchanged) stays exactly as it is** — `{ userId: string; role: Role }`, returned by the existing, unchanged `signInWithFirebaseToken`. This spec's new, richer type is a **different, new type named `CurrentUser`**, defined and used only by the functions below and by `src/lib/current-user.ts` (§4.4) — it never replaces or is confused with `SessionUser`.

```ts
export interface CurrentUser {
  userId: string;
  role: Role;
  seekerProfileId: string | null;
  insiderProfile: { id: string; verifiedAt: Date | null } | null;
}
```

- `getCurrentUserFromDb(deps: { db: Database }, userId: string): Promise<CurrentUser | null>` — returns `null` if the user no longer exists. Re-derives role and profile state fresh on every call — no caching of role in the cookie is ever trusted for authorization (see §4.4 for why a DB read wins over re-issuing the cookie at the moment of promotion: the Insider guard needs `verifiedAt`, which the cookie never carries and which must eventually reflect the planned 90-day re-verification cadence anyway — out of scope for this slice, but the design must not make it harder to add later; an admin role change or account deletion must also take effect on the very next request, not after up to 30 days; this matches the existing codebase rule that jobs "re-check current state before acting" rather than trust a stored snapshot).

- **`resolveLanding(user: CurrentUser): "/admin" | "/onboard" | "/seeker/dashboard" | "/insider/dashboard"` — pure function, no `deps`.** Single source of truth for "where does a signed-in user go", used by `/login`'s post-sign-in redirect, `/onboard`'s already-onboarded check, and both app layouts. Exhaustive, evaluated top to bottom, first match wins:

  | # | Condition | Destination |
  |---|---|---|
  | 1 | `role === "admin"` | `/admin` |
  | 2 | `seekerProfileId !== null` | `/seeker/dashboard` |
  | 3 | `insiderProfile !== null && insiderProfile.verifiedAt !== null` | `/insider/dashboard` |
  | 4 | `insiderProfile !== null && insiderProfile.verifiedAt === null` | `/onboard` (resumes the unverified OTP step, §4.9) |
  | 5 | (nothing matches — no profiles at all) | `/onboard` |

  **Third-pass fix:** the previous revision put the verified-Insider row ahead of the Seeker-profile row. Two problems followed: (a) it violated this table's own original requirement that a user with both profiles lands on `/seeker/dashboard`, and (b) it meant a Seeker who started (but abandoned) adding the Insider role — creating an unverified `insider_profiles` row — was routed to `/onboard` on every future login and could never reach their Seeker dashboard by the normal path, even though `canAccessSeekerApp` would have let them in if they typed the URL directly. Putting the Seeker-profile row second fixes both: a `both`-role user (verified or not) always lands on `/seeker/dashboard` by default, and an abandoned add-Insider attempt never traps a Seeker. Reaching the Insider dashboard or resuming Insider onboarding now happens only via `/insider/*`'s own layout guard (§4.10) or the explicit `add=insider` intent, never as the default landing for a user who also has a Seeker profile.

- **"Fully onboarded", defined:** a `CurrentUser` is fully onboarded once `resolveLanding` would return something other than `/onboard` — i.e. rows 1, 2, or 3 match. Row 4 (unverified Insider, no Seeker profile) is *not* fully onboarded. `/onboard`'s own starting-step table (§4.9) checks this per-row, in order — it is not a separate pre-check that runs before that table.

- **Add-role intent, new:** `/onboard` accepts an optional query parameter `add: "seeker" | "insider"`. When present and the corresponding profile doesn't already exist, it overrides the default landing/step derivation to start that specific step instead (Seeker name step for `add=seeker`, Insider name+email step for `add=insider`), **regardless of what `resolveLanding` would otherwise say.** This is how a verified Insider adds a Seeker profile (`USER-FLOWS.md`'s "Add Insider role" — read as generally "add the other role", named `add=seeker` here for a Seeker profile specifically) and, symmetrically, how a Seeker adds the Insider role. If the target profile already exists, `add` is ignored and normal `resolveLanding` applies. The link to reach `/onboard?add=seeker` or `?add=insider` is out of scope for this slice (it belongs on a profile screen not yet built) — this spec only needs the parameter itself to exist and work when a URL carries it, since `/onboard` must not depend on a UI entry point that doesn't exist yet to be internally correct.

- `createOrGetSeekerProfile(deps: { db: Database }, userId: string, fullName: string): Promise<SeekerProfileRecord>` — race-safe idempotency, not "find then insert" (which still races under a real concurrent double-submit against `seeker_profiles_user_id_idx`). Implemented via a new DB-layer method (§4.3) using `ON CONFLICT (user_id) DO NOTHING` plus a re-select, matching how this codebase's notifications-insert code already handles the same class of race (confirmed pattern: the `onConflictDoNothing` insert plus re-read at `src/adapters/db/real.ts:859` — not `createRedemption`, which uses select-then-insert inside a transaction and is not race-safe against a concurrent double-submit the way this needs).

- **`startWorkEmailOtp`'s and `verifyWorkEmailOtp`'s existing `deps` parameter types narrow from `IdentityDeps` (`{ db, auth }`) to `Pick<IdentityDeps, "db">`.** Neither function reads `auth` today (confirmed by reading both bodies) — this is a strict narrowing, so every existing caller passing a full `IdentityDeps` still type-checks unchanged. This is a small Plan A edit to `identity.ts` itself, not just a note about the new functions below. It removes the need for any new function to construct an `IdentityDeps` or call `getAdapters()` internally — a domain module calling `getAdapters()` would violate AGENTS §2.2 (modules are pure and receive adapters only via `deps`).

- `requestWorkEmailOtp(deps: Pick<IdentityDeps, "db"> & { email: EmailSender }, userId: string, workEmail: string): Promise<{ insiderProfileId: string }>` — calls the existing `startWorkEmailOtp(deps, ...)`, now narrowed to `Pick<IdentityDeps, "db">` (above), passing the same `deps` object straight through — no internal `IdentityDeps` construction. Then renders and sends a minimal OTP email — subject `"Your GetNudgd work-email code"` (via `brand.name`, never hardcoded — see AGENTS §0.2), body: one sentence plus the 6-digit code, no HTML beyond a `<p>` — to `workEmail` via `EmailSender.send`, synchronously (the user is waiting on this screen; `notify()` doesn't fit, since it always sends to `user.email`, not a work address that may differ). Returns only `{ insiderProfileId }` — the code itself is never returned to the caller.

- `verifyWorkEmailOtpForUser(deps: Pick<IdentityDeps, "db">, userId: string, code: string): Promise<boolean>` — resolves the Insider profile from `userId` (via `getInsiderProfileByUserId`, §4.3), then calls the existing `verifyWorkEmailOtp(deps, insiderProfileId, code)`, now also narrowed to `Pick<IdentityDeps, "db">` (above — the prior revision's claim that this one was "already `{ db}`-only, unchanged" was itself false; both functions get the same narrowing in the same edit). Never accepts a caller-supplied `insiderProfileId` — closes the ownership gap the first draft had.

### 4.3 DB layer additions (Plan A) — `src/adapters/db/types.ts`, `fake.ts`, `real.ts`

- `getSeekerProfileByUserId(userId: string): Promise<SeekerProfileRecord | null>`
- `getInsiderProfileByUserId(userId: string): Promise<InsiderProfileRecord | null>`
- `createOrGetSeekerProfile(userId: string, fullName: string): Promise<{ record: SeekerProfileRecord; created: boolean }>` — real: one `INSERT ... ON CONFLICT (user_id) DO NOTHING RETURNING *`; if no row returned, re-`SELECT` by `user_id` and return `{ record, created: false }`. Fake: check-then-insert is acceptable (the fake has no real concurrency, same convention as every other fake in this codebase).
- **OTP invalidation, defined concretely:** `storeWorkEmailOtp`'s behavior changes to, in the same transaction as inserting the new row, `UPDATE work_email_otps SET consumed_at = now() WHERE insider_profile_id = $1 AND consumed_at IS NULL` for every earlier unconsumed code belonging to that profile (setting `consumed_at`, not deleting rows — matches `consumeWorkEmailOtp`'s own existing semantics of marking rows consumed rather than removing them). Fake and real must implement this identically (a fake/real parity contract test, per this codebase's existing convention, is required — not optional — since a silent divergence here is exactly the kind of bug that's invisible until a live/E2E run).
- Contract tests for both new reads and `createOrGetSeekerProfile` (fake and real).

### 4.4 Session freshness — `src/lib/current-user.ts` (Plan A)

A new `server-only` module: decodes the session cookie (via the existing, unchanged `getSessionFromCookies` in `src/lib/session.ts`), then calls `identity.getCurrentUserFromDb`, wrapped in React's `cache()` so multiple reads within one request/render tree share one DB round-trip. The cookie itself (`SessionPayload`, unchanged) remains only an identity carrier (`userId`, `issuedAt`, and its existing `role` field, kept for backward compatibility but never read for authorization by any new code this spec adds).

`src/lib/authorize.ts`'s `authorize()` function: **its first parameter's type widens from `SessionPayload | null` to `Pick<SessionPayload, "userId" | "role"> | null`** (a strict widening — every existing caller passing a full `SessionPayload`, which has `issuedAt` too, still type-checks unchanged; only new callers can now pass the narrower `{ userId, role }` shape sourced from a `CurrentUser`). New callers built in Plan B always pass `{ userId: currentUser.userId, role: currentUser.role }` from the fresh `CurrentUser`, never the raw cookie payload.

### 4.5 `problems.ts` (Plan A) — new, minimal, `src/lib/problems.ts`

First real consumer of the RFC-7807-flavored pattern `AGENTS.md` §4.4/§2.7 describes. Scoped tightly to what this slice can raise:

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

/** For a known, named condition that isn't a thrown JS error (e.g. a boolean check that failed). */
export function problem(type: ProblemType): Problem { /* looks up the human title for `type` */ }

/** For a caught exception: maps known error classes to a Problem, everything else (including ZodError) falls through. */
export function mapErrorToProblem(err: unknown): Problem { /* ZodError -> "validation-failed"; WorkEmailDomainError/InsiderCompanyChangeError/InvalidTokenError -> their types; anything else -> "unexpected" */ }
```

Callers use `problem(type)` directly for the two boolean-returning-false cases this slice has (`verifyWorkEmailOtpForUser` returning `false` → `problem("otp-invalid-or-expired")`; dev-login's fixed-code check failing → `problem("dev-login-wrong-code")`), and `mapErrorToProblem(err)` only for genuinely thrown exceptions. **Copy is written fresh in `problem`'s title lookup, in human language — no thrown error's `.message` is ever rendered directly** (AGENTS.md §4.6). Every server action in this slice returns `{ ok: true } | { ok: false; problem: Problem }` per AGENTS.md §4.4.

### 4.6 Rate limiting (Plan A) — new, `src/lib/limiters.ts`

Three named exports, each a `RateLimiter` from the existing, currently-unused `createInMemoryRateLimiter` (`src/lib/ratelimit.ts`, unchanged):

```ts
export const devLoginLimiter = createInMemoryRateLimiter(5, 60_000);   // 5 attempts / minute
export const otpSendLimiter = createInMemoryRateLimiter(3, 5 * 60_000); // 3 sends / 5 minutes
export const otpVerifyLimiter = createInMemoryRateLimiter(5, 5 * 60_000); // 5 attempts / 5 minutes
export function limiterKey(userId: string | null, headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for");
  const ip = forwardedFor?.split(",")[0]?.trim() ?? "unknown"; // Caddy sets this in prod; unavailable in dev/test, "unknown" is an accepted shared bucket for local runs
  return `${userId ?? "anon"}:${ip}`;
}
```
`limiterKey` takes `Headers`, not `Request` — server actions receive no `Request` object; Plan B callers get headers via `await headers()` from `next/headers`. When `x-forwarded-for` carries a comma-separated chain (proxy hops), only the first entry is used. Deliberately in-memory/single-replica for now, matching `AGENTS.md` §3.5's own stated interim design. Plan B's server actions call these three limiters and `limiterKey`; Plan A owns their values and the key format so they aren't duplicated or drift between call sites.

### 4.7 `/login` (Plan B) — `app/(public)/login/page.tsx` + `actions.ts`

Two-step UI (email → 6-digit code), gated by `env.DEV_LOGIN_ENABLED && process.env.NODE_ENV !== "production"` checked **independently in both the page (returns `notFound()` if not enabled) and the server action (returns `{ ok: false, problem: problem("auth-invalid-token") }` if not enabled)** — never inferred from the UI being hidden, and understood as defense in depth on top of §4.1's adapter-level control, not the primary one. The action:
```ts
async function devLoginAction(input: { email: string; code: string }): Promise<ActionResult>
```
validates with Zod, checks `devLoginLimiter` via `limiterKey(null, await headers())` (from `next/headers`), checks `code === "000000"` (the fixed dev code — this exact string, and **only** inside this action; it is a completely separate code space from the work-email OTP verified by `verifyWorkEmailOtpForUser`, which must never accept it), derives `providerUid` deterministically as `` `dev:${email.toLowerCase()}` `` (the action never takes a client-supplied ID token), builds the fake identity token server-side, calls `signInWithFirebaseToken`, sets the session cookie, then reads the fresh `CurrentUser` and redirects via `resolveLanding`. "Continue with Google" is out of scope.

### 4.8 `/logout` (Plan B)

A `logoutAction` server action (`app/(public)/login/actions.ts` or a shared `app/actions.ts` — implementer's call, not load-bearing): `clearSessionCookie()`, redirect to `/`. Its trigger is a "Log out" button in each app shell's nav (`app/seeker/layout.tsx`, `app/insider/layout.tsx`, `app/(admin)/admin/layout.tsx` — one small addition to each, alongside the existing nav links) — this spec does not design new nav UI beyond that one button.

### 4.9 `/onboard` (Plan B) — `app/(public)/onboard/page.tsx` + `actions.ts`

Access: signed in, else redirect to `/login`. There is no separate "already onboarded" pre-check that runs before the table below — the table itself, evaluated top to bottom, decides both the starting step and whether to redirect away; row 5 is the only row that redirects away (per §4.2's "fully onboarded" definition, with no matching `add` param), and it is checked last, after every row that would resume or start a step. **The starting step is derived from server state (the fresh `CurrentUser`) plus the `add` param, never client state**, so a reload or a direct link never loses progress. Ordered, first match wins:

| # | Condition | Starting step |
|---|---|---|
| 1 | `insiderProfile !== null && insiderProfile.verifiedAt === null` | Resume at OTP-entry (§4.9's 2b OTP screen), with "Resend code" and "Use a different email" |
| 2 | `add === "seeker" && seekerProfileId === null` | Seeker name step (2a) |
| 3 | `add === "insider" && insiderProfile === null` | Insider name+email step (2b) |
| 4 | `seekerProfileId === null && insiderProfile === null` | Role-choice step (1) |
| 5 | (fully onboarded, no matching `add`) | redirect per `resolveLanding` |

- **Role choice step (1):** client component, existing `Chip`/`Card` primitives, no data — routes to 2a or 2b (equivalent to reaching row 2/3 above without an `add` param, just via the choice UI instead of a URL).
- **2a, Seeker:** `fullName` field → action → `createOrGetSeekerProfile(deps, currentUser.userId, fullName)` → redirect `/seeker/dashboard`.
- **2b, Insider:** `fullName` + `workEmail` fields → action → `requestWorkEmailOtp(deps, currentUser.userId, workEmail)`. **`fullName` is collected on this screen per `USER-FLOWS.md` §4's field list, but nothing in the current schema stores an Insider's name** (`insider_profiles` has no name column, confirmed). This spec does **not** add that column (a schema change belongs to a backend task, not this frontend-adjacent slice) — `fullName` is collected on this screen for UI/copy consistency with the Seeker step and validated (non-empty), but is **not persisted** in this plan; state this explicitly in the implementation so nobody assumes it's saved. (Follow-up in §6.) An unresolved domain shows `problem("work-email-domain-not-registered")`'s human copy inline → OTP-entry step (single 6-digit field, `autocomplete="one-time-code"`, `inputmode="numeric"`) → action → `verifyWorkEmailOtpForUser(deps, currentUser.userId, code)` → success: redirect `/insider/dashboard`; failure: `problem("otp-invalid-or-expired")` inline, `otpVerifyLimiter` checked first.
- Every action: Zod parse → `current-user.ts`'s fresh `CurrentUser` (never a client-supplied id) → `authorize()` → exactly one module call → redirect or `revalidatePath`.

### 4.10 Layout guards (Plan B, calling Plan A's decision functions)

**The access-rule decision logic itself lives in Plan A as pure, named, independently-testable functions** (not as prose duplicated across sections, and not written directly inside the layouts): `canAccessSeekerApp(user: CurrentUser): boolean`, `canAccessInsiderApp(user: CurrentUser): boolean`, `canAccessAdmin(user: CurrentUser): boolean`, alongside `resolveLanding` in `identity.ts` (or a sibling `src/modules/identity/access.ts` if that keeps `identity.ts` from growing too large — implementer's call). Definitions:

- `canAccessAdmin(user)`: `user.role === "admin"`.
- `canAccessSeekerApp(user)`: `user.seekerProfileId !== null`. (Role is irrelevant here — `both` and bare `seeker` both qualify by having a profile; `admin` is handled separately, see below.)
- `canAccessInsiderApp(user)`: `user.insiderProfile !== null && user.insiderProfile.verifiedAt !== null`.

`app/seeker/layout.tsx`, `app/insider/layout.tsx`, `app/(admin)/admin/layout.tsx` each become thin `async` server components: read the fresh `CurrentUser` via `current-user.ts`, then:

- No session → redirect `/login`.
- **Seeker layout:** `canAccessAdmin(user)` → render anyway (an admin can view the Seeker app; this is a deliberate inclusion, not an oversight — admins are never blocked from any app). Else `canAccessSeekerApp(user)` → render. Else → redirect `/onboard?add=seeker`.
- **Insider layout:** `canAccessAdmin(user)` → render anyway, same reasoning. Else `canAccessInsiderApp(user)` → render. Else, if `user.insiderProfile !== null` (exists but unverified) → redirect `/onboard` (row 1 of §4.9's table resumes the OTP step with no `add` param needed). Else (no Insider profile at all) → redirect `/onboard?add=insider` — **not** `/seeker/dashboard` as the first draft said; sending someone who explicitly navigated to `/insider/*` into Insider onboarding, not away from it, is the correct default now that `add=insider` exists to make that intent explicit.
- **Admin layout:** `canAccessAdmin(user)` → render. Else → `notFound()` (never a redirect that reveals the route exists).
- Every action still independently re-derives the current user and re-checks per §4.9's own rule — layouts are UX, not the enforcement boundary; this doesn't change from the first draft.

### 4.11 Dev mailbox for the Insider OTP email (Plan A backend piece; Plan B's E2E test is its only consumer)

- **A new adapter wrapper, not a change to `createFakeEmailSender` itself:** `createFileMailboxEmailSender(filePath: string): { sender: EmailSender }` in `src/adapters/email/` — wraps `createFakeEmailSender()`, and on every `send()` call also appends the message as one JSON line (`{ to, subject, html, sentAt }`) to `filePath` (creating the file if absent). `.sent` in memory still works as today for unit tests; the file is purely for a separate process (Playwright) to read.
- `env.ts` gains `DEV_MAILBOX_PATH: z.string().optional()`, with the same production refusal as `DEV_LOGIN_ENABLED` (fails `getEnv()` if set and `NODE_ENV === "production"`).
- `adapters.impl.ts`: when `NODE_ENV !== "production"` and `DEV_MAILBOX_PATH` is set, `email` resolves to `createFileMailboxEmailSender(env.DEV_MAILBOX_PATH).sender` instead of the plain fake; otherwise unchanged (plain `createFakeEmailSender().sender` as today, or the real Brevo adapter once that exists).
- **Never logged** (OTP codes are secret-shaped data), **never exposed by any page or API route** — filesystem-only, opt-in via the env var, read directly by the Playwright test process from the same file path it configured.

### 4.12 Design constraints (from AGENTS.md Part 4, applies to Plan B)

Tokens only, no arbitrary Tailwind values. `/login` and `/onboard` live in `app/(public)`, default `.seeker-scope`; the Insider step of onboarding switches to `.insider-scope` so `var(--primary)` changes accordingly. Forms max-width 680px, mobile-first at 390px; screenshots attached at 390px and 1280px per the frontend definition-of-done. Labelled inputs, focus-visible styles, 4.5:1 contrast. Locked vocabulary: "Insider", "Seeker", "Get vouched in" (never "Get referred"); brand name from `src/config/brand.ts`, never hardcoded.

## 5. Testing

**Plan A (unit, no UI):**
- `getCurrentUserFromDb`, `resolveLanding` (every row of its table), `canAccessSeekerApp`/`canAccessInsiderApp`/`canAccessAdmin` (every `CurrentUser` shape, including the admin-with-no-profiles and verified-Insider-no-Seeker-profile cases the earlier drafts got wrong), per AGENTS.md §3.6's "every denial case" requirement.
- The `DEV_LOGIN_ENABLED`/`DEV_MAILBOX_PATH`-in-production `getEnv()` failure.
- The production auth adapter rejecting every token.
- `createOrGetSeekerProfile`'s race-safety (a concurrent-call test against the fake, plus the real-adapter contract test).
- `requestWorkEmailOtp` sending via the fake `EmailSender` (asserting subject/body) and the OTP-invalidation-on-resend behavior (fake and real parity).
- `verifyWorkEmailOtpForUser` resolving from `userId`, never trusting a caller-supplied profile id.
- All three rate limiters' denial paths.
- `problem()` and `mapErrorToProblem()` for every listed type/error class.
- `createFileMailboxEmailSender` writing valid JSON lines.

**Plan B:**
- Component tests for the onboarding step components (state transitions, inline validation), Testing Library, existing convention.
- Server-action tests against fake adapters for `/login`'s dev-login action, `/logout`, and every `/onboard` action — including that `devLoginAction` and the layouts genuinely call Plan A's functions rather than re-implementing logic.
- Placeholder `/seeker/dashboard`, `/insider/dashboard`, `/admin` pages — minimal (a heading and "signed in as X"), enough for the layouts and E2E test to have somewhere to land; full dashboards are separate future work.
- **First browser-driven Playwright test in the repo**, isolated from the existing module-driven flows via a **separate config file**, `playwright.browser.config.ts` (own `testDir: "./tests/e2e-browser"`, own npm script `test:e2e:browser`) — **not** a `projects` entry or `testMatch` glob inside the existing `playwright.config.ts`, since `webServer` and `globalSetup` are top-level Playwright config, not per-project; adding this to the existing config would start `next dev` (with `DEV_LOGIN_ENABLED`/`DEV_MAILBOX_PATH` set) and run `tests/e2e/global-setup.ts` on every Flow A/B/C run. This new config has no `globalSetup` of its own — each test seeds what it needs directly. `webServer` launches `next dev`; the run uses `ADAPTERS=real` (real dev Postgres, seeded companies) and `DEV_LOGIN_ENABLED=true`; **every test generates a unique email per run** (the same tag convention the existing live tests already use — `users_email_idx` is a unique index, and `dev:${email}` derivation means a fixed email always resolves to the same user, so reusing one across runs would silently reuse state). The seeded Insider flow uses one of the three placeholder companies from `scripts/seed.ts` (any of `acme.com`/`betasystems.com`/`gammalabs.io` — pick the first and name it explicitly in the test, don't rely on `limit 1` ordering). Flows: new Seeker sign-in → lands on `/seeker/dashboard`; new Insider sign-in → dev-login `000000`, then a real work-email OTP read from the dev-mailbox file → lands on `/insider/dashboard`; returning user signs in → lands directly on their dashboard, skips `/onboard`; a signed-out visit to `/seeker/dashboard` redirects to `/login`.

## 6. Risks and follow-ups

- Real Firebase (web SDK, Admin adapter, Google sign-in) is deliberately deferred; when it lands, only `/login`'s action and `adapters.impl.ts`'s auth selection should need to change.
- The visible role-switcher widget is out of scope; `resolveLanding` and the `add` query param already cover the underlying mechanism without it.
- **Insider `fullName` is collected on the onboarding screen but not persisted** (§4.9) — `insider_profiles` needs a name column before it can be. Track this as a near-term backend follow-up; until then the field exists only for UI consistency and basic validation.
- OTP abuse controls here are a minimum (rate limit + single-active-code); a persistent per-profile attempt counter is a reasonable future hardening.
- The Insider guard checks only that `verifiedAt` is set; enforcing the planned 90-day re-verification staleness is out of scope for this slice, but `resolveLanding`/`canAccessInsiderApp` are the two places that check would extend, by design.
- `consumeWorkEmailOtp` does a select then an update, not one atomic statement (existing code, unchanged by this spec) — a known hardening item, not introduced here.
- `/for-insiders` (the public landing page `USER-FLOWS.md` §3 describes as `/onboard`'s natural entry point) is not built in this spec; `/onboard` must still work correctly when reached directly or via `?add=`.
