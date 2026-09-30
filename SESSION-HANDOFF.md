# GetNudgd — Session Handoff (rewritten 2026-09-30, after Playwright critical-flow E2E tests)

Written for a fresh Claude Code session (or Anmol) picking this up cold. Read this first, then `AGENTS.md` (the binding engineering spec), then `USER-FLOWS.md` (page-by-page UX reference) if you need product/UX detail. `PRD.md`/`TRD.md` are the requirements docs those draw from.

This file replaces the 2026-09-29 version, which listed Playwright critical-flow tests as one of three next-step options. Two of the three flows are now done; the third is intentionally partial pending a feature that doesn't exist yet.

---

## 0. TL;DR — where things stand

- `main` has everything through **Phase 1 Timers**, the **notifications module** (plus its hardening, a queue hotfix, and the singleton-policy fix), the **rewards module**, and **Playwright critical-flow E2E tests**. Merge commits, in order: notifications `ea8c24d`, queue hotfix `1be49d3`, notifications hardening `f298daa`, rewards `b25385b`, singleton policy `f7e31e6`, Playwright E2E `818c90f` (all `--no-ff`). The handoff commit sits on top.
- **Nothing is in flight.** No open branches besides `main`, no worktrees.
- **Nothing has been pushed.** `origin/main` is far behind local `main` and stays that way until Anmol says to push.
- Verified on `main` after the Playwright merge: `npm run lint` clean, `npm run typecheck` clean, `npm test` 49 files passed + 3 skipped (501 tests passed, 15 skipped — three opt-in live-test files), and `npm run test:e2e` (real dev Postgres, real pg-boss, real in-process worker) 8 passed + 1 skipped (the deliberate Flow A interview-leg `fixme`).
- Untracked and deliberately not committed (waiting for Anmol to say so): `PRD.md`, `TRD.md`, `USER-FLOWS.md`.

**Phase 1 backend is now functionally complete except for the interview-confirmation feature itself.** Flow B and Flow C (§1b) are fully done; Flow A stops where the codebase itself stops, at proof verification. The next step is Anmol's call between: (a) deciding the interview-confirmation design so rewards' tranche 2 can be wired AND Flow A's interview leg can finally be written (§5 item 2 — this is now the most natural next backend item, since it's the one remaining thing blocking two other pieces of work), (b) starting the frontend (still zero real screens — see §3), or (c) something else. A paste-ready prompt for whichever is chosen is in §9; it asks first rather than assuming.

---

## 1. Rewards module — what is on `main` now

Spec: `docs/superpowers/specs/2026-09-25-rewards-module-design.md` (founder-approved 2026-09-25). Plan: `docs/superpowers/plans/2026-09-25-rewards-module-plan.md` (its last section, "Final review findings and deferred follow-ups", is the canonical follow-up list).

| Piece | Where |
|---|---|
| Rewards config (`pointsPerCredit`, `paisePerPoint`, `giftCardBrands` — optional in the schema so old rules versions still parse), `RewardsNotConfiguredError`, `computeTranchePoints` | `src/modules/config/schemas.ts`, `src/modules/rewards/points.ts` |
| Seed: `rules` **version 2** with the three fields as placeholders (40 points/credit, 100 paise/point, `["amazon","flipkart"]`); version 1 untouched | `scripts/seed.ts` |
| `insider_rewards` / `reward_redemptions` tables, migration `0011_rewards_tables.sql` | `drizzle/schema.ts`, `drizzle/migrations/` |
| `Database.rewards.{releaseTranche, listRewards, createRedemption, resolveRedemption, getRedemptionById, listRedemptions, getWallet}` — atomic, locked, idempotent (fake + real) | `src/adapters/db/{types,fake,real}.ts` |
| `applyTransition` gains an optional `trancheRelease` so a proof verification and its tranche-1 payout commit or fail together, in one transaction | `src/adapters/db/{fake,real}.ts` (`requests.applyTransition`) |
| `GiftCardVendor` interface, `createManualFulfilmentVendor` (always `pending`), fake | `src/adapters/giftcards/` |
| 3 new notification templates: `reward.released`, `redemption.fulfilled`, `redemption.rejected` (8 templates total) | `src/modules/notifications/templates.ts` |
| `rewards` module: `releaseTranche`, `getWallet`, `listRewards`, `listRedemptions`, `requestRedemption` (validates minimum/brand, holds points, calls the vendor once, never re-calls it on replay) | `src/modules/rewards/rewards.ts` |
| `reviewProof(verify)` computes tranche-1 points **before** `applyTransition` runs (a `RewardsNotConfiguredError` aborts before any write) and releases them atomically with the state change; admin `fulfilRedemption`/`rejectRedemption`/`listRewardRedemptions`, each writing `admin_audit_log` in the same transaction as the ledger move | `src/modules/admin/admin.ts` |
| Live integration test (opt-in) | `src/modules/rewards/rewards.live.test.ts` |

**Not tested at all:** any UI, server actions, `authorize()`/actor identity for `requestRedemption` (out of scope — arrives with server actions), a real gift-card vendor, tranche 2 (built and unit-tested, but nothing calls it — see the interview-confirmation gap in §5 item 2).

### Still open (recorded in the plan's final section; none block anything today)

- **Isolation-level assumption, documented not fixed:** the overspend and escrow-hold checks (`sendRequest`, `createRedemption`) rely on the connection running at READ COMMITTED (Postgres's default). Under REPEATABLE READ they would not error and could both succeed. Whoever wires the real connection pool must pin READ COMMITTED or add a serialization-failure retry wrapper — now stated in a code comment next to both locks in `real.ts`.
- **Lock order and single-currency assertion are only enforced for the new rewards paths.** The older credits flows and the generic `ledger.post`/`postTxn`/`applyTransition` don't go through the new `postEntriesInTx` helper. No live risk today; a future credits-purchase flow running concurrently with a rewards flow on the same accounts should route through the same helper.
- **`resolveRedemption` has no idempotency key of its own.** A second `fulfilRedemption` call with a **different** `vendorRef` silently returns the first result — money-safe, but the corrected reference is lost. Fix when server actions wire admin up.
- **`requestRedemption` validates before checking idempotency**, so a replay after config changes underneath it throws instead of returning the held redemption.
- Standalone `Database.rewards.releaseTranche` has no production caller today; a concurrent standalone call for the same `(requestId, tranche)` throws instead of returning the existing reward — no double payment either way.
- A handful of test-quality-only minors are listed at the end of the plan file.

---

## 1a. Notifications hard gate — CLOSED (merge `f7e31e6`, 2026-09-29)

The `notify:{id}` `singletonKey` used to do nothing under pg-boss's default `standard` queue policy. **Fix:** the `notify.send` queue now uses pg-boss's `singleton` policy, under which at most one job with a given key can be `active` at a time, queue-wide.

| Piece | Where |
|---|---|
| `QueuePolicy` type, `SendOptions.policy`, `QueueClient.work()`'s new third parameter (`{ policy?, pollingIntervalSeconds? }`) | `src/jobs/queue.ts` |
| `send()`/`work()` forward `policy` into `boss.createQueue()`; `work()` warns (never throws) if a queue already existed under a different policy | `src/jobs/queue.real.ts` |
| `enqueueDelivery` and `worker.ts`'s `notify.send` registration both request `policy: "singleton"` | `src/modules/notifications/notifications.ts`, `src/jobs/worker.ts` |
| Opt-in live test: two independent `createRealQueueClient` instances proving same-key jobs never overlap under `singleton` policy, a `standard`-policy control that DOES overlap, and the real `notify()`/`deliverNotification` path delivers exactly once under a forced race | `src/jobs/queue.singleton-policy.live.test.ts` |

**Residual, documented, not blocking:** singleton policy serializes same-key jobs but doesn't replace `deliverNotification`'s own `status === "sent"` guard — exactly-once still depends on both together. A vendor send succeeding right before a crash before `markSent` persists is the same pre-existing at-least-once gap as always.

**One-time dev-database fixup:** any `notify.send` queue created before this fix keeps its old `standard` policy forever (`ON CONFLICT DO NOTHING`). This repo's dev DB was already fixed by the live test's own `beforeAll`. A first-ever production deploy needs no such step.

---

## 1b. Playwright critical-flow E2E tests — Flow B and Flow C done, Flow A partial (merge `818c90f`, 2026-09-30)

Spec: `docs/superpowers/specs/2026-09-29-playwright-e2e-flows-design.md` (revised once after an opus design review found real gaps before any code was written — see its own history). Plan: `docs/superpowers/plans/2026-09-29-playwright-e2e-flows-plan.md`. Executed **natively** (inline, one session, no per-task subagent review) on opus's own recommendation when asked to choose an execution method — the plan's code was judged complete enough that a fresh per-task reviewer wasn't needed, with one opus review of the whole branch as the only independent check.

**Two decisions made with the founder before any code was written (recorded in the spec, not reopened):**
1. No UI or `/api/v1` route exists yet, so every flow drives the system via direct calls to the real module functions (`sendRequest`, `accept`, `decline`, `expire`, `submitProof`, `admin.reviewProof`) against real adapters, with a real in-process worker delivering through fake email/WhatsApp. Playwright is still the test runner AGENTS.md names; when real pages or API routes exist, only each flow's *driving* calls change.
2. Flow A cannot be completed today — no function anywhere drives the `interview`/`complete`/`windowExpiry`/`close` transitions `state.ts` defines (confirmed by grep: nothing outside `state.ts` itself references them). Flow B and Flow C ship in full; Flow A runs everything that exists (send → accept → proof → verify, including tranche-1 points) and marks the interview leg `test.fixme()`.

| Piece | Where |
|---|---|
| `@playwright/test` (new devDependency, caret range per repo convention — the lockfile pins the exact version), `playwright.config.ts` (`testDir`, `workers: 1`, `fullyParallel: false` — load-bearing, see below — `globalSetup`, `timeout: 120_000`) | `package.json`, `playwright.config.ts` |
| `global-setup.ts`: fails fast (sub-second) with an actionable message if Postgres is unreachable, no companies are seeded, the latest `rules` has no `pointsPerCredit`, **or a `notify.send` backlog is already queued** (added in the final-review fix pass — see below) | `tests/e2e/global-setup.ts` |
| Shared fixtures: `createE2eContext` (real db/queue + fake email/WhatsApp + a real in-process worker), `seedFundedSeeker`, `seedVerifiedInsider`, `seedAdminUser`, `notificationKey`, `findNotification`, `waitUntil` (async, throws on timeout — not the differently-shaped helper local to the singleton-policy live test) | `tests/e2e/fixtures.ts` |
| Flow B (send→decline→refund), Flow C (send→expire→refund, calling `expire()` directly — the same thing the real 48h timer job calls, so nothing waits 48 real hours) — both fully passing, every credit amount computed from the request's own stamped `rulesVersion`, never a literal | `tests/e2e/flow-b-decline-refund.spec.ts`, `tests/e2e/flow-c-expiry-refund.spec.ts` |
| Flow A (send→accept→proof→verify, asserting tranche-1 points via `db.rewards.getWallet`/`listRewards`) passes; its interview leg is `test.fixme()` with a message naming the exact gap, reported as skipped (not silently missing) via `reporter: "list"` | `tests/e2e/flow-a-interview.spec.ts` |
| ESM-interop smoke test (`pg-boss` is ESM-only; this repo is CommonJS — proves the interop works under Playwright's compiler before any fixture depends on it) | `tests/e2e/smoke.spec.ts` |
| `vitest.config.ts`/`eslint.config.mjs`/`.gitignore` updated so `tests/e2e/**` and Playwright's `test-results/`/`playwright-report/` never touch `npm test` or lint | — |

**Why `workers: 1` / `fullyParallel: false` is load-bearing, not stylistic:** `startWorker()` registers a handler on the single, real, hard-coded `"notify.send"` pg-boss queue. Two Playwright worker *processes* each starting their own in-process worker would become two independent consumers racing for jobs on that shared queue. Running everything sequentially in one process, with each flow's `teardown()` fully stopping its queue client before the next flow's setup starts, is the only way two `notify.send` registrations are guaranteed never to be live at once.

**A real bug was found and fixed while building Flow C:** the shared, long-lived dev database had accumulated 7 undelivered `notify.send` jobs from earlier ad-hoc live-test runs that session (including a stale malformed `request.accepted` row), and pg-boss's default throughput (batchSize 1, 2000ms poll ≈ 0.5 jobs/s) couldn't clear that backlog within the original 10s notification-wait budget. Fixed by: draining the backlog once via a throwaway script using the real `startWorker`/`deliverNotification` code path (never committed); raising every flow's notification `waitUntil` from 10s to 30s; raising the config's per-test timeout to 120s. **The final whole-branch review correctly flagged that this treated the symptom without a way to detect it recurring**, so a fix pass added `checkNotifySendBacklog` to `global-setup.ts`: it now fails fast, by name, if a backlog already exists, instead of letting a future flow time out with a message that reads like a delivery bug.

**Run it:** `docker compose -f infra/compose.dev.yml up -d postgres` (already running is fine), then in a subshell: `export $(grep -v '^#' .env.local | grep -v '^$' | xargs -d '\n'); npm run db:migrate; npm run db:seed; npm run test:e2e`. **Never export `.env.local` before plain `npm test`.** Never run `npm run worker:dev` against the same `DATABASE_URL` while this suite runs — it's an independent consumer of the same queue and causes the identical race `workers: 1` prevents within the suite itself.

**Deferred minors from the final review (none blocking):** a comment in Flow A overstates independence from `computeTranchePoints` (it re-derives the same formula for one of four assertions, though the other three are genuinely independent); the 120s config timeout has exactly zero headroom for Flow A's four sequential 30s waits in a true worst case (reword the comment or raise to 150s); `retries: 0` should be set explicitly in `playwright.config.ts` to document the "must fail, never retried away" intent (currently 0 by Playwright's own default); `global-setup.ts` is missing the "never run alongside `worker:dev`" comment that `fixtures.ts` already has; `createE2eContext` looks up the seeded company *after* starting the worker, so a failure there skips `teardown()` (each spec's `afterAll` should use `ctx?.teardown()`); the 30s wait constant is named only in Flow A, repeated as a literal in Flow B/C; `waitUntil` doesn't fail fast on an explicit `"failed"` notification status; per-file tags rely on `Date.now()` timing for uniqueness rather than including the flow name; production `notify.send` throughput (~0.5 jobs/s at pg-boss defaults) is worth its own tuning ticket before real notification volume.

---

## 2. What is merged to `main`, in order

Everything below is tested, reviewed, and merged.

| Plan | What it built |
|---|---|
| Phase 0 (backend + frontend) | Repo restructure, Dockerfile, `env.ts`/`brand.ts`, Drizzle schema + first migrations, `ledger` module, `requests/state.ts` state machine, `config` module + seed, adapter interfaces + fakes, `/api/health`, pg-boss worker scaffold, CI pipeline, `components/ui/*` primitives, role-scoped app shells, known-defect removal |
| Phase 1 Identity Foundation | `identity` module — Firebase token exchange (fake adapter only), HMAC session cookies, company-email OTP, `authorize()` |
| Phase 1 Insiders & Resumes | `insiders` module (search/detail/availability, config-driven cost), `resumes` module (upload registration only); fixed idempotent insider-profile creation, role promotion on verification, and a cross-company verification escalation |
| Phase 1 Requests & Escrow | `sendRequest`/`accept`/`decline`/`expire` with real escrow (`SELECT … FOR UPDATE`, zero-sum ledger triggers, idempotency); fixed `rules_version` not honored on refund, an unnamespaced idempotency key, a missing append-only trigger |
| Phase 1 Proof & Admin Verify | `submitProof`, `admin.reviewProof` / `listPendingProofs` with mandatory audit logging; fixed `getProofByRequestId` returning the oldest proof, untested reject-audit path, contentless proofs accepted |
| Direct fixes | `src/lib/adapters.ts` factory (real vs fake db/queue), idempotent company seeding, `Countdown.tsx` flakiness, `.worktrees/**` excluded from lint/test |
| Phase 1 Timers (merge `4e6710e`) | `request.expire` job, `requests.sweep` hourly cron, pg-boss `startAfter`/`singletonKey` wiring, `src/jobs/run-worker.ts`, `adapters.impl.ts` split. Follow-ups: `docs/superpowers/plans/2026-09-20-phase-1-timers-plan.md`. |
| Notifications (merge `ea8c24d`) | See the notifications plan's own follow-up section. |
| Queue hotfix (merge `1be49d3`) | `queue.real.ts` omits unset pg-boss options (found by a live run). |
| Notifications hardening (merge `f298daa`) | Event-derived notification idempotency (migration `0010`), pending sweep, failure bookkeeping, opt-in live integration test. |
| Rewards (merge `b25385b`) | See §1. Follow-ups: the last section of the rewards plan. |
| notify.send singleton policy (merge `f7e31e6`) | Closes the notifications hard gate. See §1a. Bounded task, no plan/spec file. |
| **Playwright E2E** (merge `818c90f`) | Flow B and Flow C fully, Flow A partial. See §1b. |

**Migrations on `main`:** `0000`–`0011`.

---

## 3. Overall completion estimate

**Roughly 37% done.**

- **Backend:** Phase 0 complete. Phase 1: identity, insiders search, resume upload registration, send-request + escrow, accept/decline/expire, proof + admin verify, timers, notifications and rewards are all done. **Playwright coverage is done for what the backend currently supports** (Flow B, Flow C, Flow A's non-interview leg); the only thing left in Phase 1 backend is the interview-confirmation feature itself. Phase 2 and 3: nothing started.
- **Frontend:** only Phase 0 scaffolding (primitives, role-scoped shells, brand wiring). **Zero real screens** — `app/seeker/`, `app/insider/`, `app/(admin)/admin/` each contain only a `layout.tsx`. Every backend module built so far has no UI in front of it yet.
- **Real vendor adapters:** only `db` (Postgres/Drizzle) and `queue` (pg-boss). Firebase Auth, Cloud Storage, Brevo, WhatsApp BSP, OpenAI, Razorpay, gift-card vendor are fake-only.
- **Infra/deploy:** local Docker dev works. VPS, Caddy, CI→deploy pipeline: not started. `npm run test:e2e` is runnable locally but not wired into any CI (none exists).

Method: raw item counts from AGENTS.md §3.11/§4.9, weighted down because the frontend and every real vendor integration are untouched and no deploy work has happened. A directional gut-check, not a burn-down.

---

## 4. Local dev environment (Docker/Postgres)

- Docker Desktop is a user-local install, **not on PATH**: `C:\Users\dml-anmol\AppData\Local\Programs\DockerDesktop\resources\bin` (`docker.exe`, `docker-compose.exe`).
- Docker Desktop is not always running when a session starts. Start it, wait for `docker version` to succeed (~10–60s), then `docker compose -f infra/compose.dev.yml up -d postgres` (Postgres 16 on 5432, Gotenberg on 3050). The volume `infra_getnudgd-postgres-data` persists across stops.
- Module tests run on fakes and need no Postgres. Start it to apply new migrations and run the opt-in live tests or `npm run test:e2e`.
- `.env.local` at the repo root is git-ignored and **does not propagate to new worktrees** — copy it in. Standalone `tsx`/live-test/`test:e2e` runs need its variables exported in a subshell:
  ```bash
  export $(grep -v '^#' .env.local | grep -v '^$' | xargs -d '\n')
  ```
  **Never export it before running the full `npm test`** — `ADAPTERS=real` makes `src/config/env.test.ts` fail. Only export it for `db:migrate`/`db:seed`/a live-test run/`test:e2e`, in a subshell that doesn't leak into later commands.
- **Merging `package.json` changes into `main` (or any checkout) requires `npm install` there too** — a merge brings the new dependency entry but not the installed package; `npm run typecheck`/`npm test` will fail with a "Cannot find module" error until `npm install` runs on that checkout. This bit the Playwright merge on 2026-09-30 (harmless, just an extra step, but don't skip it and don't mistake the error for a real regression).
- **`npm run test:e2e` needs the dev Postgres up, migrated, and seeded, and will fail fast with a named reason if it isn't** (or if a `notify.send` backlog is already queued — see §1b). Never run it at the same time as `npm run worker:dev` against the same database.

---

## 5. Known gaps and deferred decisions (carry forward)

Canonical detail is in `USER-FLOWS.md` §9. Short version:

1. **Seeker/Insider profile fields are thinner than `PRD.md` R4.** `seeker_profiles` has only `full_name`; `insider_profiles` has company/work-email/verification/`available`/`weekly_limit`. City, domain, target companies, seniority, vouch roles, bio: not in the schema.
2. **Interview confirmation and disputes — unreconciled TRD-vs-code gap. Blocks tranche 2 AND Flow A's interview leg.** `TRD.md` §6.1 describes `INTERVIEW_REPORTED`/`DISPUTED` and `declineAfterReview`; none exist in `src/modules/requests/state.ts` (11 states, no dispute step). Rewards' tranche 2 is fully built and tested but has no caller. Playwright's Flow A (`tests/e2e/flow-a-interview.spec.ts`) has a `test.fixme()` waiting for this too. Whoever builds it must decide: the simpler single-timer version, or extend the state machine first — then wire tranche 2 through `applyTransition.trancheRelease` the way tranche 1 is wired in `reviewProof`, AND turn Flow A's fixme into a real test. **This is now the single most-referenced open decision in the codebase — two independent pieces of already-shipped work are waiting on it.**
3. **`rewards` module is done**; see §1. No longer blocks `/insider/rewards` or `/admin/redemptions` at the backend level — both still need their frontend.
4. **`admin_audit_log` mandatory-write is per-call-site, not type-enforced.** `applyTransition`'s `adminAudit` is optional; a future admin mutation could forget it and still compile.
5. **Weekly Insider capacity limits are tracked but not enforced.** Needs the `insider.weeklyReset` cron and an enforcement design first.
6. **`authorize.ts` has no `insiderRequest` resource type**, and `submitProof`/`reviewProof`/`requestRedemption` take no actor identity. All must change when server actions wire these modules up.
7. **No adapter contract tests** (`RUN_VENDOR_TESTS=1` fake/real parity suite from AGENTS.md §3.8) — each module instead got its own bespoke opt-in live test. Works, but isn't the systematic contract suite the spec describes.
8. **Rewards, notifications-hard-gate, and Playwright follow-ups** — see §1, §1a, §1b. Timers follow-ups are in the Timers plan doc.

---

## 6. How this project is run

Every piece of backend work follows the AGENTS.md Part 6 loop, adapted by two lessons this session learned the hard way:

1. Research the current code directly (read files; don't trust memory or old docs).
2. **Classify the work before reaching for a plan file** (superpowers:brainstorming: spike / bounded / architectural). A well-scoped change to existing code with no new subsystem is *bounded*: a short in-chat design, one approval, straight to implementation — no spec, no plan file (the singleton-policy fix, §1a, is the template for this). New subsystems, new tables, or genuinely open design forks are *architectural* and get the full spec → plan → execution pipeline.
3. For architectural work: write a spec to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`, get it reviewed (an opus design review, before any plan exists, has twice now found real gaps a plan built from an unreviewed spec would have inherited — see the Playwright spec's own revision history), then `superpowers:writing-plans` → `docs/superpowers/plans/YYYY-MM-DD-<topic>-plan.md`. Commit both to `main`.
4. Create an isolated worktree off **local** `main` with manual `git worktree add .worktrees/<name> -b <name>` — the native `EnterWorktree` default branches from `origin/main`, which is far behind local `main`.
5. `npm install`, copy `.env.local`, verify a clean baseline (`npm test`, `npm run lint`, `npm run typecheck`).
6. **Choose an execution method deliberately, don't default to subagent-driven-development out of habit.** When a plan's own tasks already contain complete, exact code (every task in `writing-plans`' output should), a fresh per-task reviewer mostly re-checks a transcription against its source — real value there is lower than on a plan built from prose. Ask the most capable available model to decide subagent-driven vs. native for a *specific* plan, weighing: how many tasks, how coupled their interfaces are, and — critically — what a shipped mistake in *this* plan actually costs (a wrong test is not a wrong production money-bug). The Playwright plan went native on exactly this reasoning and it held up: only one Important finding at the final review, no Critical.
7. Whichever method: **never skip the final whole-branch review on opus.** It has caught a real, load-bearing bug or a real design gap on every piece of work this session, native or subagent-driven, spec-reviewed or not.
8. `superpowers:finishing-a-development-branch`: merge with a merge commit into `main`, re-run lint/typecheck/tests (and any live tests / `test:e2e` touched) on `main`, do not push, remove the worktree, delete the branch, update `SESSION-HANDOFF.md`.

SDD scripts (used by both subagent-driven-development and executing-plans) live at `C:\Users\dml-anmol\.claude\plugins\cache\claude-plugins-official\superpowers\6.4.1\skills\subagent-driven-development\scripts\` (`task-brief`, `review-package`, `sdd-workspace`) and `...\executing-plans\scripts\` (`task-start`, `task-done`). The version segment changes when the plugin updates; check the directory.

**Model tiers and cost (Anmol's standing preference, 2026-09-25):**

- Implementers on **sonnet** (haiku takes more turns and saves little). Reviewers on **sonnet** for small/mechanical diffs; **opus** only for the final whole-branch review and *subtle-logic* tasks. Always pass `model` explicitly.
- **"Subtle" is defined, not judged per task:** opus for anything touching money, state transitions, idempotency, concurrency or message sending. Sonnet for templates, adapter fakes, wiring, docs, and — per the Playwright branch — Playwright/test-infrastructure scaffolding itself.
- Hand briefs, reports and diffs over as file paths; never paste them. No prior-task summaries in new dispatches.
- **Put known pitfalls in the brief/spec up front** so they never become fix rounds.
- **Carry hardening forward explicitly** across tasks; don't leave it to "the final review will catch it."
- **Reviewers write the full review to a file** and return only the verdict plus one-line findings.
- Fix rounds: covering tests only, full suite once before the commit; one fix, one dispatch (subagent-driven) or one TDD'd fix pass (native, per `executing-plans`'s own discipline of fixing Critical/Important yourself and *never* bundling in Minors — "I'll fix the minors too while I'm in there" is an explicit anti-pattern the skill calls out, and the Playwright branch's final fix pass followed it: one Important fix, ten Minors deferred to the ledger, none bundled).
- **Never skip the final whole-branch review on opus.**
- If a subagent stalls, a session errors out mid-task, or a stopped subagent can't be resumed, check the worktree's real state before doing anything (see §7).

Ledger rule (both `subagent-driven-development` and `executing-plans`): each plan's ledger is `.superpowers/sdd/<plan-basename>/progress.md` in its worktree — same directory, same format, so a plan can switch executors mid-flight. A `Task N: complete` line means done — do not redo it. The ledger is deleted after a clean final review; its `Ruling:` lines and deferred minors are the thing that survives into this handoff.

---

## 7. Lessons that cost time — don't repeat

- **Fakes and mock-based tests can't see vendor-library validation or environment debris.** A bug in the real pg-boss adapter passed 391 tests and two reviews before a live run caught it. A shared, long-lived dev database accumulating an undelivered `notify.send` backlog from earlier live-test runs cost a debugging session on the Playwright branch before it was traced to environment state, not a code bug. Any change to `queue.real.ts`/`db/real.ts` needs its own opt-in `*.live.test.ts`; any E2E suite touching the same shared queue needs its own preflight check for exactly this class of debris (see `checkNotifySendBacklog`, §1b) rather than just a generous timeout.
- **An opus design review of a SPEC, before any plan or code exists, is worth doing even when the design feels settled.** The Playwright spec's first draft had five real Critical-grade gaps (a wrong assumption about which `rules` version gets stamped, a missing foreign-key fixture, a flaky test design, a wrong claim about Playwright API behavior, a race under default parallelism) that an opus review caught before a single line of test code was written. Cheaper to fix in a spec than in a plan, cheaper in a plan than in code.
- **Ask the most capable model to choose the execution method for a specific plan, rather than defaulting.** Subagent-driven isn't always the more careful choice — for a plan whose tasks already carry complete, exact code, going native (one execution context, one final review) is often the same real risk at a fraction of the cost. Match the method to what could actually go wrong in *that* plan, not to habit.
- **When fixing findings from a final review yourself (native execution), fix Critical/Important only, and genuinely defer every Minor to the ledger — don't bundle "while I'm in there."** Each additional fix is its own test, its own suite run, and its own chance to introduce something nobody reviewed. This discipline held on the Playwright branch: one Important fix (a backlog preflight check, TDD'd), ten Minors deferred, none silently rolled into the same commit.
- `.env.local` is missing in fresh worktrees, and Docker Desktop is not reliably running at the start of a session — check both before a live-test or `test:e2e` task.
- **Merging a `package.json` change into another checkout (e.g. `main`, after a worktree merge) requires `npm install` there too** — the merge brings the dependency entry, not the installed package. Don't mistake the resulting "Cannot find module" typecheck error for a real regression; just install and re-run.
- Merging a worktree can double test counts if `.worktrees/**` isn't excluded from `vitest.config.ts` and `eslint.config.mjs` (it is now, plus `tests/e2e/**` for Playwright specs).
- **Idempotency keys must embed the entity id** (`send:`, `request:{id}:{event}`, `notify:{notificationId}`, `request:{id}:tranche:{n}`, `redemption:{id}:hold/fulfil/reject`). This bug class appeared repeatedly across modules — check it explicitly in every review.
- **"Get the current X for Y" queries must `ORDER BY createdAt DESC`** or they return the oldest row.
- pg-boss v12 needs `createQueue` before `send`/`work`/`schedule` — only visible against real pg-boss, not the fake. Its default throughput (batchSize 1, 2000ms poll) is only ~0.5 jobs/s — worth remembering before assuming a queue "should be fast."
- `server-only` throws under vitest; the worker can't import `server-only` modules (hence `adapters.impl.ts`).
- **Plan text isn't gospel** — reviewers should flag plan-mandated defects as findings, not excuse them.
- **Locking money code needs an explicit, stated isolation-level assumption**, not just a working test.
- **A stopped subagent cannot be resumed — don't retry `SendMessage` to one.** If its uncommitted work is still sitting in the worktree and looks complete and correct (read the diff yourself first), dispatch a *fresh* agent whose only job is to verify and commit it.
- **A shell command this tool auto-backgrounds can hang forever, stuck on its very first pipeline step**, producing an empty output file with no error and no completion notice. After a session hiccup, re-check `git log`/`git status` directly rather than trusting the backgrounded one is still working. If a `git worktree remove`/`rm -rf` afterward fails with "Device or resource busy" and no obvious process shows up in an app-name filter, search ALL processes' full command lines for the branch/directory name — it may be exactly this kind of zombie process, not an external app. Kill it and retry.
- **Two independent `createRealQueueClient`/`PgBoss` instances in one test file is a legitimate way to simulate two worker processes** for a concurrency test. But a concurrency test needs its own control case proving the methodology can detect the failure it claims to prevent — a control assertion that's silently loosened to a tautology (`>= 1` instead of `=== 2`) proves nothing.
- **Reading a backgrounded command's output file repeatedly is fine (Read is read-only and doesn't need permission), but don't chain sleeps or use Bash/PowerShell/Monitor to poll it** — those hit the same action-classifier gate as any other write-capable tool call and can stall on a transient classifier failure. Read the output file directly and wait for the actual completion notification.
- `git worktree remove` can leave the directory behind with "Permission denied"/"Device or resource busy" if something (the shell's own cwd, or a zombie process — see above) still references it; the worktree is still deregistered — `rm -rf` the leftover directory from outside it once whatever's holding it is gone.
- The shell cwd can end up inside a worktree. Use absolute paths, and never run shared-checkout git from inside a worktree.
- Never use bare `git stash` — the stash stack is shared across worktrees and sessions.
- Don't use `ScheduleWakeup` outside `/loop`.

---

## 8. Definition of "version 1"

The user wants the final commit, when everything in AGENTS.md is done, tagged/committed as **version 1**. That is far off (see §3). Do not tag it early.

---

## 9. Paste-ready prompt for the new session

Copy everything between the lines into the new session. It asks Anmol to choose the next step rather than assuming one.

```
Continue GetNudgd. First read C:\Users\dml-anmol\Claude\Caveman\getnudgd\SESSION-HANDOFF.md
fully, then AGENTS.md, and node_modules/next/dist/docs/ before any Next.js code.

Situation: main has Phase 0, Phase 1 Identity/Insiders/Requests/Proof/Timers, notifications
(plus hardening, a queue hotfix, and the singleton-policy fix), the rewards module, and
Playwright critical-flow E2E tests (Flow B and Flow C fully done, Flow A partial with a named
fixme on its interview leg) — all merged, lint/typecheck clean, 501 tests passing + 15 skipped
(vitest), and 8 passed + 1 skipped on `npm run test:e2e` (live, re-verified on 2026-09-30).
Nothing is in flight, nothing is pushed, no worktrees exist. PRD.md, TRD.md, USER-FLOWS.md are
untracked; do not commit them unless Anmol says so.

Do this, in order:
1. Verify: `git status --short`, `git log --oneline -5`, `git worktree list`. ListAgents to
   make sure no other session is working in this repo. Confirm Docker Desktop is running
   before anything that needs Postgres.
2. Ask Anmol which of these is next (SESSION-HANDOFF §0 lays out the tradeoffs) — do not
   assume:
   a. Design and build interview confirmation (SESSION-HANDOFF §5 item 2) — this now unblocks
      BOTH rewards' tranche 2 AND Playwright Flow A's remaining fixme test. The single most
      natural next backend item.
   b. Start the frontend — zero real screens exist yet for any backend module built so far.
   c. Something else Anmol has in mind.
3. Classify the chosen work per superpowers:brainstorming (spike / bounded / architectural)
   BEFORE assuming a full spec+plan is needed. For architectural work: superpowers:brainstorming
   -> spec in docs/superpowers/specs/ -> get the spec reviewed (an opus design review, before
   any plan exists, has twice now found real gaps a plan would otherwise have inherited) ->
   superpowers:writing-plans -> plan in docs/superpowers/plans/, commit both to main. Either
   way: worktree off LOCAL main (manual `git worktree add`), copy .env.local, verify baseline.
4. Choose an execution method deliberately (subagent-driven-development vs. native/inline) —
   ask the most capable available model to decide for THIS plan specifically, weighing task
   count, interface coupling, and what a shipped mistake actually costs; don't default out of
   habit. Models, set explicitly either way: implementers sonnet; reviewers sonnet for
   small/mechanical diffs, opus for money/state-transition/idempotency/concurrency/
   message-sending tasks and any final whole-branch review. Pass briefs/reports/diffs as file
   paths, never pasted.
5. If executing natively: when the final review finds issues, fix Critical/Important yourself
   via TDD (write the test that reproduces the finding, watch it fail, fix, watch it pass, run
   the whole suite) and genuinely DEFER every Minor to the ledger — do not bundle "while I'm in
   there" (the Playwright branch's own discipline: one Important fix, ten Minors deferred).
6. Any change to a real adapter (`*.real.ts`) or to how a queue/job is created needs its own
   opt-in `*.live.test.ts` (or an addition to `npm run test:e2e`) against the dev Postgres
   before merge, with a control case proving the test can actually detect the failure it
   claims to prevent.
7. If a subagent or a background shell command goes silent across a session interruption,
   check `git log`/`git status` on the real worktree directly — don't assume it's still
   working. A stopped subagent cannot be resumed (SendMessage will refuse) — dispatch a fresh
   agent to verify-and-commit already-correct uncommitted work, not redo it.
8. When done: final whole-branch review on opus, fix pass if needed,
   finishing-a-development-branch with a MERGE COMMIT into main. Remember: merging a
   package.json change into main requires `npm install` there too before typecheck/test will
   pass. Re-run lint/typecheck/tests (and any live tests / test:e2e touched) on main, DO NOT
   PUSH, remove the worktree, delete the branch, update SESSION-HANDOFF.md and commit it.

Stop and ask Anmol only for irreversible or security-sensitive actions, or if the plan is
broken so every path forward is a guess. End by telling him the final main SHA and whether
the working tree is clean.
```
