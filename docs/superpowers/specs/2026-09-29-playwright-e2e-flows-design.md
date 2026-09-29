# Playwright Critical-Flow E2E Tests — Design

Date: 2026-09-29 (revised after opus review). Status: draft for founder review. Sources: `AGENTS.md` §1.3 (`tests/e2e`), §2.5/§2.11/§0.5 (append-only, dependencies, config-not-code), §3.8 (Flow A/B/C), §3.6 (`authorize()`), §4.7 (frontend-only Playwright flows, out of scope here), §8 (`npm run test:e2e`), `SESSION-HANDOFF.md` §4 (env/Docker), §5 item 2 (interview gap), §6 (model tiers), `USER-FLOWS.md` §9.

## 1. Goal

Implement the three end-to-end flows AGENTS.md §3.8 names, using the tool it names (Playwright), against the real stack it names ("Playwright against compose").

## 2. Two decisions made with the founder before this design (recorded, not reopened)

1. **No UI or `/api/v1` surface exists yet.** Drive the flows via direct calls to the real module functions (`sendRequest`, `accept`, `decline`, `expire`, `submitProof`, `admin.reviewProof`) against real adapters (`createRealDatabase`, `createRealQueueClient`), the shape already proven in `src/modules/notifications/notifications.live.test.ts`, `src/modules/rewards/rewards.live.test.ts`, and `src/jobs/queue.singleton-policy.live.test.ts`. Playwright's test runner is still the real, permanent seam: when real pages or `/api/v1` routes exist, only each flow's *driving* calls change.
2. **Flow A cannot be completed today.** No function drives the `interview`/`complete`/`windowExpiry`/`close` transitions `state.ts` defines (confirmed: grepped the whole repo, nothing outside `state.ts`/`state.test.ts` references them). Ship Flow B and Flow C fully now; Flow A runs everything that exists (send → accept → proof → verify, including tranche-1 reward release) and then marks the interview leg `test.fixme()`.

## 3. Scope

In: Playwright installed and configured; `tests/e2e/fixtures.ts` shared setup; `flow-b-decline-refund.spec.ts`; `flow-c-expiry-refund.spec.ts`; `flow-a-interview.spec.ts` (partial); `npm run test:e2e` wired and working; `vitest.config.ts` updated so `npm test` never loads these files.

Out (and why): any UI or `/api/v1` route (decision 1); the interview-confirmation feature itself (decision 2 — its own future work); CI wiring (no CI pipeline exists yet); the frontend-only Playwright flows AGENTS.md §4.7 separately lists (onboarding both roles, credit-gate redirect, admin verify UI) — those need real pages and are not this task; PAN gate, real vendor adapters, disputes, weekly-limit enforcement (not implemented yet, so nothing to test).

## 4. Design

### 4.1 Dependency and config

- `@playwright/test`, pinned to an exact version, as a devDependency. Justification for AGENTS.md §2.11: it is the test runner only — no `projects`/browsers are configured and `npx playwright install` is never run, because nothing in this task renders a page (decision 1). AGENTS.md §8 already documents `npm run test:e2e # playwright against compose` as a command expected to exist.
- `playwright.config.ts` at the repo root: `testDir: "./tests/e2e"`, no `projects` array, `workers: 1`, `fullyParallel: false` (§4.2 explains why this is required, not stylistic), `reporter: "list"` (so a `fixme` test's name and reason stay visible in the run output, not buried). `globalSetup` (`tests/e2e/global-setup.ts`) opens one `pg` Pool against `process.env.DATABASE_URL` and: runs `SELECT 1`; queries `select count(*) from companies` and fails if zero; queries the latest `rules` row's `value` and fails if `pointsPerCredit` is missing. On any failure it throws one error naming the exact fix: Docker Desktop is not on PATH (`C:\Users\dml-anmol\AppData\Local\Programs\DockerDesktop\resources\bin` per `SESSION-HANDOFF.md` §4) → `docker compose -f infra/compose.dev.yml up -d postgres` → `npm run db:migrate` → `npm run db:seed`.
- `vitest.config.ts`: add `"**/tests/e2e/**"` to the existing `exclude` array (same precedent as `.worktrees/**`) so `vitest run` never loads a Playwright spec.
- `eslint.config.mjs`: add `test-results/**` and `playwright-report/**` to the existing `globalIgnores` array (Playwright writes these at runtime; nothing else in the repo ignores them yet).
- `.gitignore`: add `test-results/` and `playwright-report/`.
- `package.json`: `"test:e2e": "playwright test"`.
- No `tsconfig.json` change — its `include: ["**/*.ts", ...]` already covers `tests/e2e/**` (verified: no narrower include exists), so `npm run typecheck` picks these files up for free.
- **Fixtures must be a plain module with exported functions, not Playwright's `test.extend()` fixture pattern.** `test.extend`'s `use()` callback shape trips `eslint-config-next`'s `react-hooks/rules-of-hooks` (a real risk specific to this repo's eslint config, not Playwright generally). Plain async functions called from inside each `test()` body avoid it entirely and match this codebase's existing live-test style.
- **Untried path, flagged not silently assumed:** `pg-boss` is ESM-only (`"type": "module"` in its own `package.json`); this repo is CommonJS. Vitest already loads it fine, but nothing has loaded it through Playwright's TypeScript/CJS test compiler before. The first implementation task must be a trivial smoke spec that imports `createRealQueueClient` and asserts it's a function, run and confirmed green, before any fixture or flow logic is written — if it fails, that is a real finding to report, not something to work around silently.

### 4.2 Fixtures (`tests/e2e/fixtures.ts`)

Not a test file — a plain module the specs import from. A fresh `tag` per run (never a literal), so re-runs never collide and nothing assumes the dev DB is otherwise empty — same convention as every existing live test.

**Why `workers: 1` / `fullyParallel: false` (§4.1) is load-bearing, not stylistic:** `startWorker()` registers a handler on the real, shared `"notify.send"` pg-boss queue (the literal name is hard-coded in `enqueueDelivery`, not configurable — confirmed in `notifications.ts`). If two spec files ran as separate Playwright worker processes, each starting its own in-process `startWorker()`, both would be independent consumers competing for jobs on the same real queue in the same real database; whichever process's registration happens to pick up a given job would be nondeterministic, and a flow's assertion against *its own* fake email adapter's `sent` array could see zero sends even though the notification really was delivered by the other process's fake. Running all specs sequentially in one Playwright worker process, with each flow's `teardown()` fully stopping its queue client before the next flow's `createE2eContext()` starts, avoids any two `startWorker()` registrations for `notify.send` ever being live at the same time within this run. Additionally, **never run this suite while `npm run worker:dev` is pointed at the same `DATABASE_URL`** — that is an independent, permanent consumer of the same queue and would cause the identical problem; a comment in `global-setup.ts` and in `fixtures.ts` must say so (the same caution `queue.singleton-policy.live.test.ts` already carries for the same reason).

`startWorker()` also registers `requests.sweep` and `notifications.sweep` cron handlers, which run against the *whole* `notifications`/`insider_requests` tables, not just this run's rows — on the shared dev database, a sweep tick during a test run could legitimately touch unrelated stale rows left by earlier manual testing or earlier live-test runs. This is harmless (sweeps are idempotent and only act on rows in specific states) but means **every assertion in every flow must filter by that flow's own tagged ids/addresses**, never by "the newest row" or an unscoped count.

- `createE2eContext()`: builds `pool` (`new Pool({ connectionString: process.env.DATABASE_URL })`), `db` (`createRealDatabase(drizzle(pool))`), `queue` (`createRealQueueClient(process.env.DATABASE_URL)`), and fake `email`/`whatsapp` adapters (`createFakeEmailSender()` → `{ sender, sent }`; `createFakeWhatsAppGateway()` → `{ gateway, ... }` — never real vendors). Calls `startWorker({ db, queue, email: sender, whatsapp: gateway })` (this alone starts the queue client — `startWorker` calls `deps.queue.start()` internally, so the context does not call `queue.start()` separately). Looks up one seeded company: `select id from companies limit 1` (order is unspecified — every downstream assertion must key off `request.creditCost`, the value actually charged for *that* company's tier, never a literal like "3 credits"; confirmed safe to share one company across flows since `sendRequest` enforces neither a weekly limit — not implemented yet — nor any other per-company exclusivity). Returns `{ db, pool, queue, emailSent: sent, whatsapp: gateway, companyId, teardown }`, where `teardown` calls `queue.stop()` then `pool.end()`.
- `seedFundedSeeker(db, tag, credits)`: `findOrCreateUser` + `createSeekerProfile` + a `postTxn` credit grant of at least the highest possible tier cost (read `requestCostByTier` from the latest `rules` and grant its max, not a hardcoded number). Returns `{ profileId, userId, email }`.
- `seedVerifiedInsider(db, tag, companyId)`: `findOrCreateUser` + `findOrCreateInsiderProfile(userId, companyId, workEmail)` + `markInsiderVerified`. Returns `{ profileId, userId, email }`.
- `seedAdminUser(db, tag)`: `findOrCreateUser(..., "admin")` — `admin_audit_log.admin_user_id` is a `NOT NULL` foreign key to `users.id` (confirmed in `drizzle/schema.ts`); `admin.reviewProof`'s `adminUserId` must be a real seeded user, matching the pattern `rewards.live.test.ts` already uses (`createAdminUser`). Returns the user id.
- `findNotification(pool, eventKey, template, userId)`: queries `select * from notifications where idempotency_key = $1` where the key is composed exactly as `notify()` composes it, `${eventKey}:${template}:${userId}` (confirmed in `notifications.ts`) — this is the only way to find a notification row; `Database.notifications` has no list-by-user method. Each flow computes its own `eventKey` from the transition key it already knows (e.g. `` `request:${requestId}:decline` ``, `` `request:${requestId}:expire` ``, `` `review:${requestId}:${reviewIdempotencyKey}` `` for both `proof.verified` and `reward.released` on the verify path).
- `waitUntil(check: () => Promise<boolean>, timeoutMs: number, intervalMs = 200)`: a new async helper defined here (not imported from `queue.singleton-policy.live.test.ts`, whose local `waitUntil` is synchronous-predicate-only, unexported, and silently returns on timeout instead of failing — importing it would also be wrong because it would pull that file's `describe`/`test` blocks into the Playwright run). This helper's predicate is `async`, and it `throw`s with a descriptive message (naming what it was waiting for) if `timeoutMs` elapses — a silent timeout must never look like a pass.

### 4.3 Flow B — `flow-b-decline-refund.spec.ts`

`sendRequest({ idempotencyKey, seekerProfileId, insiderProfileId })` → read the request's own `rulesVersion` back and load `getRulesWithVersion({ db }, request.rulesVersion)` (never assume "version 1" — `sendRequest` always stamps whatever `getLatest("rules")` returns at send time, which is the newest seeded version; hardcoding a version number here would silently test the wrong config the moment a new `rules` version is seeded) → `decline(deps, requestId)`.

Assertions: state `DECLINED`; the expected refund is computed in the test from `Math.round((request.creditCost * rules.refundPercentOnDecline) / 100)` (the same formula `refundEntries` uses — do not assert a literal percentage or credit amount) and the seeker's credit balance is back to its pre-send amount by exactly that much; `findNotification(pool, \`request:${requestId}:decline\`, "request.declined", seekerUserId)` reaches `status: "sent"` via `waitUntil`; the fake email's `sent` array contains exactly one message to the seeker's address (safe now that `workers: 1` rules out cross-process interference — §4.2). Note in the test file: `sendRequest` also scheduled a 48h-delayed `request.expire` job that nothing cancels; it is a harmless no-op when it eventually fires, because `expire()`'s own guard checks `state !== "SENT"` first — this is expected, not a leak to clean up.

### 4.4 Flow C — `flow-c-expiry-refund.spec.ts`

`sendRequest` → `expire(deps, requestId)` called directly. This is deliberate, not a shortcut: `expire()` is exactly the function the real `request.expire` pg-boss job calls when its 48h timer fires, and calling it directly is how this codebase's own design already treats "the timer fired" as a unit of work separate from waiting — there is nothing left to prove by actually waiting 48 real hours.

Assertions: state `EXPIRED`; refund computed from `rules.refundPercentOnExpiry` the same way as Flow B (not a literal); `findNotification(..., "request.expired", seekerUserId)` reaches `sent`.

### 4.5 Flow A — `flow-a-interview.spec.ts` (partial)

Two separate `test()`s in one file (not one test): the working leg is real coverage on its own merit, independent of whether the interview leg ever gets written; when interview confirmation is eventually implemented, completing this file means either adding a third test that continues from the first's request, or converting the two into `test.describe.serial`.

**Test 1 (runs):** `sendRequest` → `accept(deps, requestId)` → `submitProof(deps, { idempotencyKey, requestId, proofType: "text", textContent: <non-empty> })` (pinned to `"text"`; `"screenshot"` needs an `objectKey` into Storage, which is out of scope) → `seedAdminUser` → `admin.reviewProof(deps, { idempotencyKey: reviewKey, adminUserId, requestId, decision: "verify" })`.

Assertions: state `SUBMITTED`; `findNotification(..., "request.accepted", seekerUserId)` reaches `sent` (fired by `accept()` — asserting it costs nothing extra and strengthens the flow); `findNotification` for `proof.verified` reaches `sent` for both the Insider's and the Seeker's user ids (`review:${requestId}:${reviewKey}` is the shared event key for both); tranche-1 points: load `rules` from `request.rulesVersion` (same rule as §4.3 — never assume a version), and if `rules.pointsPerCredit` etc. are missing this run's `globalSetup` already failed fast, so this is reachable by construction; assert independently of the production formula (not just re-deriving `computeTranchePoints` again, which would let a bug in that function pass silently): `db.rewards.getWallet(insiderProfileId).balance > 0`, `db.rewards.listRewards(insiderProfileId)` has exactly one row with `tranche === 1` and `requestId === request.id`, `lifetimeEarned === balance`; `findNotification(..., "reward.released", insiderUserId)` reaches `sent`.

**Test 2 (does not run):**
```ts
test.fixme(
  "interview confirmation and tranche 2 (blocked: no confirmInterview()/reportInterview() function exists — " +
  "state.ts defines the interview/complete/windowExpiry/close transitions but nothing drives them; " +
  "see USER-FLOWS.md §9 and SESSION-HANDOFF.md §5 item 2, 'Interview confirmation and disputes')",
  async () => { /* intentionally empty */ }
);
```
**Correction from the design's first draft:** `test.fixme()` does not make Playwright fail loudly if the gap is ever accidentally closed — a `fixme` test simply never runs, and is reported as **skipped** (with its title and reason visible via `reporter: "list"`, which is why that reporter is required in §4.1, not optional). The earlier claim that Playwright "fails the run and demands the annotation be removed" was wrong; `test.fail()` is the API with that behavior, but it requires a body that actually runs and is expected to throw, which doesn't fit "the function doesn't exist yet." `test.fixme()` with a named reason and a reporter that surfaces it is the correct choice for "cannot run today, must stay visible" — just not for the reason originally stated.

## 5. Testing and verification

- Run against the existing dev compose stack: `docker compose -f infra/compose.dev.yml up -d postgres` (confirmed: Postgres + Gotenberg only, no app/worker service), `npm run db:migrate`, `npm run db:seed`. `.env.local` must be exported in a subshell before `npm run test:e2e` (`export $(grep -v '^#' .env.local | grep -v '^$' | xargs -d '\n'); npm run test:e2e`) — and, as with every other command in this repo that touches real adapters, **never** exported before plain `npm test`, or `ADAPTERS=real` breaks `env.test.ts`. `global-setup.ts`'s failure message states this exact invocation.
- `npm run test:e2e` must fail fast (sub-second) and name the fix if the stack isn't up, isn't migrated, or isn't seeded past v1 (§4.1's `globalSetup` checks).
- Each flow's own assertions are its test — no separate unit-test layer for this task.
- `npm test` (vitest) must show the identical file/test count before and after this change — confirms `tests/e2e/**` is truly excluded.
- `npm run lint` and `npm run typecheck` must stay clean with the new files included.
- **Verify the ESM-interop risk (§4.1) explicitly**, before writing any fixture: a standalone smoke spec importing `createRealQueueClient`, run and shown green in the plan's own verification output.

## 6. Model tiers for the implementation plan (founder preference, `SESSION-HANDOFF.md` §6)

Fixtures and all three flow files touch money (credit/point balances), state transitions, and message sending — opus reviews each. Playwright/vitest/eslint config wiring and the `package.json`/`.gitignore` scaffolding are mechanical — sonnet implements and reviews.

## 7. Risks and follow-ups

- Not wired into any CI pipeline (none exists yet). When one is built, it needs to bring up the compose stack and export env correctly as its own step.
- When real UI or `/api/v1` routes land, each flow's *driving* calls (not its fixtures, assertions, or the ESM-interop finding) are the intended thing to swap.
- Flow A's `test.fixme()` must become a real test the moment interview confirmation exists.
- `rules` version drift: if a `rules` v3 is ever seeded with different refund percentages or points economics, these flows keep working unchanged, because every assertion reads the percentage/formula from the request's own stamped version rather than asserting a literal — this was a correctness bug in the first draft of this spec, now fixed by design, not just by convention.
