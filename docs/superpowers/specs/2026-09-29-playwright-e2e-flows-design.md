# Playwright Critical-Flow E2E Tests — Design

Date: 2026-09-29. Status: draft for founder review. Sources: `AGENTS.md` §1.3 (`tests/e2e`), §3.8 (Flow A/B/C), §8 (`npm run test:e2e`), `SESSION-HANDOFF.md` §0/§5.2.

## 1. Goal

Implement the three end-to-end flows AGENTS.md §3.8 names as the last item in the Phase 1 backend backlog, using the tool it names (Playwright), against the real stack (Postgres + pg-boss) it names ("Playwright against compose").

## 2. Two decisions made with the founder before this design (recorded, not reopened here)

1. **No UI or `/api/v1` surface exists yet** (zero real screens; no API routes beyond health/survey/waitlist). Founder chose: drive the flows via direct calls to the real module functions (`sendRequest`, `accept`, `decline`, `expire`, `submitProof`, `admin.reviewProof`) against real adapters (`createRealDatabase`, `createRealQueueClient`) — the same shape already proven in `src/modules/notifications/notifications.live.test.ts`, `src/modules/rewards/rewards.live.test.ts`, and `src/jobs/queue.singleton-policy.live.test.ts` — rather than building throwaway UI or a new API layer just to satisfy this task. Playwright's test runner and `npm run test:e2e` are still the real, permanent seam: when real pages or `/api/v1` routes exist, only the *driving* calls in each flow file change (e.g. `sendRequest(deps, input)` → `page.click(...)` or `request.post(...)`); the fixtures, assertions and flow structure do not.
2. **Flow A cannot be completed today.** `src/modules/requests/state.ts` defines `interview`/`complete`/`windowExpiry`/`close` as valid transitions, but no function anywhere in the codebase drives them — this is the unresolved "interview confirmation and disputes" gap (`SESSION-HANDOFF.md` §5.2, "Not decided"). Founder chose: ship Flow B and Flow C fully now; Flow A runs everything that exists today (send → accept → proof → verify, including tranche-1 reward release since the rewards module is merged) and then is marked `test.fixme()` for the interview leg, with a message naming the exact gap, so `npm run test:e2e` reports it as a visible, named gap rather than silently missing or blocking the suite.

## 3. Scope

In: Playwright installed and configured; `tests/e2e/fixtures.ts` shared setup; `flow-b-decline-refund.spec.ts`; `flow-c-expiry-refund.spec.ts`; `flow-a-interview.spec.ts` (partial, `test.fixme()` for the interview leg); `npm run test:e2e` wired and working; `vitest.config.ts` updated so `npm test` never loads these files.

Out (and why): building any UI or `/api/v1` route (decision 1); the interview-confirmation feature itself (decision 2 — tracked as its own future piece of work, not folded in here); CI wiring for `test:e2e` (no CI pipeline exists yet per `SESSION-HANDOFF.md` §3 "Infra/deploy: ... not started" — this task only makes the command runnable locally against the dev compose stack, matching how the existing opt-in live tests work); PAN gate, real vendor adapters, disputes.

## 4. Design

### 4.1 Dependency and config

- `@playwright/test` as a devDependency — pre-approved by AGENTS.md §8, which already documents `npm run test:e2e # playwright against compose` as a command that should exist.
- `playwright.config.ts` at the repo root: `testDir: "./tests/e2e"`, no browser `projects` (nothing to render — see decision 1), a single test run with Node's environment. `globalSetup` (`tests/e2e/global-setup.ts`) opens one `pg` connection to `process.env.DATABASE_URL` and runs `SELECT 1`; on failure it throws an error naming the exact fix (`docker compose -f infra/compose.dev.yml up -d postgres`, then `db:migrate`, then `db:seed`), so a missing stack fails in under a second with an actionable message instead of Playwright's default per-test timeout confusion.
- `vitest.config.ts`: add `"**/tests/e2e/**"` to the existing `exclude` array (same precedent as the `.worktrees/**` entry already there) so `vitest run` never attempts to load a Playwright spec (which imports from `@playwright/test`, not `vitest`).
- `package.json`: `"test:e2e": "playwright test"` (matches AGENTS.md §8 exactly).
- No `tsconfig.json` change needed — its `include: ["**/*.ts", ...]` already covers `tests/e2e/**`, so `npm run typecheck` picks these files up for free (verified: no existing narrower `include`).

### 4.2 Fixtures (`tests/e2e/fixtures.ts`)

Not a test file — a plain module other specs import from. Responsibilities, mirroring the established live-test pattern exactly (a fresh `tag` per test run so re-runs never collide, and nothing assumes the dev DB is otherwise empty):

- `createE2eContext()`: builds `db` (`createRealDatabase(drizzle(new Pool({ connectionString: process.env.DATABASE_URL })))`) and `queue` (`createRealQueueClient(process.env.DATABASE_URL)`), calls `queue.start()`, starts an in-process worker via `startWorker({ db, queue, email: fakeEmail, whatsapp: fakeWhatsapp })` using `createFakeEmailSender()`/`createFakeWhatsAppGateway()` (never real vendors — these tests must never send anything real), and returns `{ db, queue, email, whatsapp, teardown }` where `teardown` calls `queue.stop()` and `pool.end()`.
- `seedFundedSeeker(db, tag, credits)`: `findOrCreateUser` + `createSeekerProfile` + a `postTxn` credit grant — same shape as the existing module-test helper `makeVerifiedInsiderAndFundedSeeker` in `src/modules/requests/requests.test.ts`, but against the real adapters and looking up one seeded company (`select id from companies limit 1` via the same `pg` pool, matching how the rewards live test does it) rather than a fake-seeded one.
- `seedVerifiedInsider(db, tag, companyId)`: `findOrCreateUser` + `findOrCreateInsiderProfile` + `markInsiderVerified`.
- `waitUntil(predicate, timeoutMs)`: the same small polling helper already used in `queue.singleton-policy.live.test.ts` — reused (imported, not re-implemented) so all E2E-style tests share one implementation.

### 4.3 Flow B — `flow-b-decline-refund.spec.ts`

`sendRequest` (rulesVersion 1, the seeded placeholder rules — `refundPercentOnDecline: 100`) → `decline`. Assertions: request state `DECLINED`; seeker's credit balance is back to its pre-send amount (100% refund per the seeded rule); a `request.declined` notification row reaches `status: "sent"` (via `waitUntil` + `db.notifications.getById`, proving the real worker actually delivered it, not just that a row was written); the fake email records exactly one send to the seeker's address.

### 4.4 Flow C — `flow-c-expiry-refund.spec.ts`

`sendRequest` → `expire(deps, requestId)` called directly (this is what the `request.expire` pg-boss job calls when the 48h timer fires — calling it directly is the correct way to test the *outcome* of that timer without waiting 48 real hours, exactly as this codebase's own `requests.sweep` design already treats `expire` as the unit of work, not the wait). Assertions: state `EXPIRED`; refund per `refundPercentOnExpiry` (100% seeded); a `request.expired` notification reaches `sent`.

### 4.5 Flow A — `flow-a-interview.spec.ts` (partial)

`sendRequest` → `accept` → `submitProof` → `admin.reviewProof(deps, { decision: "verify", ... })`. Assertions: state `SUBMITTED`; `proof.verified` notifications reach `sent` for both the Insider and the Seeker; tranche-1 points are released (`db.rewards.getWallet(insiderProfileId).balance` equals `computeTranchePoints(rules, creditCost, 1)`) and a `reward.released` notification reaches `sent`. Then:

```ts
test.fixme(
  "interview confirmation and tranche 2 (blocked: no confirmInterview()/reportInterview() function exists — " +
  "state.ts defines the interview/complete/windowExpiry/close transitions but nothing drives them; " +
  "see SESSION-HANDOFF.md §5.2, 'Interview confirmation and disputes — unreconciled TRD-vs-code gap')",
  async () => { /* intentionally empty — this test exists to be found, not to run */ }
);
```

`test.fixme()` (not `test.skip()`) is the deliberate choice: Playwright reports fixme tests distinctly in its summary, and if someone ever makes this pass by accident (impossible today, since the function doesn't exist) Playwright fails the run and demands the annotation be removed — it cannot silently stay "skipped" forever unnoticed.

## 5. Testing and verification

- Run against the existing dev compose stack (`docker compose -f infra/compose.dev.yml up -d postgres`, `db:migrate`, `db:seed` — no new compose file). `npm run test:e2e` must fail fast and clearly if that stack isn't up (via `globalSetup`).
- Each flow's own assertions ARE its test — there is no separate "unit test" layer for this task; correctness is proven by running for real against Postgres and a real worker.
- `npm test` (vitest) must be unaffected — confirm zero test-file-count change to the vitest run after adding `tests/e2e/**` to its exclude list.
- `npm run lint` and `npm run typecheck` must stay clean with the new files included.

## 6. Risks and follow-ups

- This suite is not yet wired into any CI pipeline (none exists). When one is built, `test:e2e` needs the compose stack brought up as a CI step first — out of scope here.
- When real UI or `/api/v1` routes land, each flow's *driving* calls (not its fixtures or assertions) should be swapped to go through them — that is the intended seam, not a rewrite.
- Flow A's `test.fixme()` must be turned into a real test the moment interview confirmation exists — this spec is the natural place a future implementer completes it.
