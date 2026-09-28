# GetNudgd — Session Handoff (rewritten 2026-09-28, after the rewards-module merge)

Written for a fresh Claude Code session (or Anmol) picking this up cold. Read this first, then `AGENTS.md` (the binding engineering spec), then `USER-FLOWS.md` (page-by-page UX reference) if you need product/UX detail. `PRD.md`/`TRD.md` are the requirements docs those draw from.

This file replaces the 2026-09-25 version, which said the rewards module was the next step. It is now built and merged.

---

## 0. TL;DR — where things stand

- `main` has everything through **Phase 1 Timers**, the **notifications module** (plus its hardening and a queue hotfix), and the **rewards module**. Merge commits, in order: notifications `ea8c24d`, queue hotfix `1be49d3`, notifications hardening `f298daa`, rewards `b25385b` (all `--no-ff`). The handoff commit sits on top.
- **Nothing is in flight.** No worktrees, no open branches besides `main`.
- **Nothing has been pushed.** `origin/main` is far behind local `main` and stays that way until Anmol says to push.
- Verified on `main` after the rewards merge: `npm run lint` clean, `npm run typecheck` clean, `npm test` 49 files passed + 2 skipped (492 tests passed, 12 skipped — the two opt-in live-test files), and both live-test files pass (12/12) against the dev Postgres with all 12 migrations applied.
- Untracked and deliberately not committed (waiting for Anmol to say so): `PRD.md`, `TRD.md`, `USER-FLOWS.md`.

**Phase 1 backend is now functionally complete except for Playwright flows and the notifications hard gate below.** The next step is Anmol's call between: (a) the Playwright critical-flow tests that close out AGENTS.md's Phase 1 backend backlog, (b) starting the frontend (still zero real screens — see §3), or (c) closing the notifications `singletonKey` hard gate (§2) before either real vendor lands. A paste-ready prompt for whichever is chosen is in §9; it asks first rather than assuming.

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

**Live-verified on 2026-09-28** against the dev Postgres (`export $(grep -v '^#' .env.local | grep -v '^$' | xargs -d '\n'); npm run db:migrate; npm run db:seed; RUN_VENDOR_TESTS=1 npx vitest run src/modules/rewards/rewards.live.test.ts src/modules/notifications/notifications.live.test.ts` → 12/12 passed): tranche release idempotency and atomicity (including a zero-point and an invalid-fromState case leaving no partial write); redemption hold/escrow/debit; **the overspend race** — two concurrent `createRedemption` calls exceeding the balance, run via `Promise.allSettled`, and exactly one succeeds; resolve fulfil/reject/replay/conflicting-outcome; the wallet reads; and the ledger-zero-sum invariant. The notifications live test was re-run too, since this branch changed `applyTransition` and `real.ts`: still 4/4.

**Not tested at all:** any UI, server actions, `authorize()`/actor identity for `requestRedemption` (out of scope — arrives with server actions), a real gift-card vendor, tranche 2 (built and unit-tested, but nothing calls it — see the interview-confirmation gap in §3).

### Still open (recorded in the plan's final section; none block anything today)

- **Isolation-level assumption, documented not fixed:** the overspend and escrow-hold checks (`sendRequest`, `createRedemption`) rely on the connection running at READ COMMITTED (Postgres's default). Under REPEATABLE READ they would not error and could both succeed. Whoever wires the real connection pool must pin READ COMMITTED or add a serialization-failure retry wrapper — now stated in a code comment next to both locks in `real.ts`.
- **Lock order and single-currency assertion are only enforced for the new rewards paths.** The older credits flows (`sendRequest`, `decline`, `expire`) and the generic `ledger.post`/`postTxn`/`applyTransition` (ledger entries argument) don't go through the new `postEntriesInTx` helper, so they don't get its fixed lock order or its "one currency per transaction" check. No live risk today (credits and points never appear in the same call), but a future credits-purchase flow running concurrently with a rewards flow on the same accounts should route through the same helper, or the "can never deadlock" code comment needs qualifying.
- **`resolveRedemption` has no idempotency key of its own** (by design since Task 3): "replay" means "same `redemptionId` + same outcome returns the existing row, no second ledger/audit write." A second `fulfilRedemption` call with a **different** `vendorRef` than the first silently returns the first result and writes no new audit row — money-safe, but the corrected reference is lost. Fix when the server-action task wires admin actions up: throw on a `vendorRef` mismatch, or give resolve its own idempotency key.
- **`requestRedemption` validates before checking idempotency**, so a replay after `giftCardBrands`/`minRedemptionPoints` changes underneath it throws instead of returning the already-held redemption. Fix order when server actions land: look up the key first.
- Standalone `Database.rewards.releaseTranche` has no production caller today (tranche 1 goes through `applyTransition`); if tranche 2 is ever called this way directly instead of through `applyTransition`, two concurrent calls for the same `(requestId, tranche)` throw a unique-violation instead of returning the existing reward (no double payment, just an avoidable error — catch-and-re-read if this path is ever used standalone).
- A handful of test-quality-only minors are listed at the end of the plan file (weaker-than-ideal assertions in a couple of replay tests); none affect production code.

### Notifications hard gate — still open, unrelated to rewards

Carried over from the notifications-hardening merge, unaffected by this branch: the `notify:{id}` `singletonKey` does **not** dedupe on pg-boss's default `standard` queue policy. Double delivery is prevented today only by a single worker running one job at a time plus `deliverNotification`'s `status === "sent"` guard. **This must be closed before any real `EmailSender`/`WhatsAppGateway` is wired, or before running more than one worker/increasing concurrency.** Fix: an atomic claim (`UPDATE notifications SET status='sending' WHERE id=$1 AND status IN ('pending','failed') RETURNING`) or a deduplicating queue policy (needs a new queue name on existing databases, since policy is set at queue creation).

---

## 2. What is merged to `main`, in order

Everything below is tested, reviewed (implementer → task reviewer → fix loop → whole-branch final review), and merged.

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
| **Rewards** (merge `b25385b`) | See §1. Follow-ups: the last section of the rewards plan. |

**Migrations on `main`:** `0000`–`0011`.

---

## 3. Overall completion estimate

**Roughly 35% done.**

- **Backend:** Phase 0 complete. Phase 1: identity, insiders search, resume upload registration, send-request + escrow, accept/decline/expire, proof + admin verify, timers, notifications and rewards are all done. **Only Playwright critical-flow tests remain to close out Phase 1 backend.** Phase 2 and 3: nothing started.
- **Frontend:** only Phase 0 scaffolding (primitives, role-scoped shells, brand wiring). **Zero real screens** — `app/seeker/`, `app/insider/`, `app/(admin)/admin/` each contain only a `layout.tsx`. Every backend module built so far (insiders, requests, proof, notifications, rewards) has no UI in front of it yet.
- **Real vendor adapters:** only `db` (Postgres/Drizzle) and `queue` (pg-boss). Firebase Auth, Cloud Storage, Brevo, WhatsApp BSP, OpenAI, Razorpay, gift-card vendor are fake-only.
- **Infra/deploy:** local Docker dev works. VPS, Caddy, CI→deploy pipeline: not started.

Method: raw item counts from AGENTS.md §3.11/§4.9, weighted down because the frontend and every real vendor integration are untouched and no deploy work has happened. A directional gut-check, not a burn-down.

---

## 4. Local dev environment (Docker/Postgres)

- Docker Desktop is a user-local install, **not on PATH**: `C:\Users\dml-anmol\AppData\Local\Programs\DockerDesktop\resources\bin` (`docker.exe`, `docker-compose.exe`).
- Docker Desktop is not always running when a session starts (seen again on 2026-09-28, after being fine on 2026-09-25). Start it, wait for `docker version` to succeed (~10–60s), then `docker compose -f infra/compose.dev.yml up -d postgres` (Postgres 16 on 5432, Gotenberg on 3050). The volume `infra_getnudgd-postgres-data` persists across stops, so no re-migrate/re-seed is needed unless `docker volume ls` shows it gone.
- Module tests run on fakes and need no Postgres. Start it to apply new migrations and run the opt-in live tests.
- `.env.local` at the repo root is git-ignored and **does not propagate to new worktrees** — copy it in. Standalone `tsx`/vitest-live-test runs need its variables exported in a subshell:
  ```bash
  export $(grep -v '^#' .env.local | grep -v '^$' | xargs -d '\n')
  ```
  **Never export it before running the full `npm test`** — `ADAPTERS=real` makes `src/config/env.test.ts` fail. Run the full suite in a clean shell; only export `.env.local` for `db:migrate`/`db:seed`/a live-test run, in a subshell that doesn't leak into later commands.
  The worker smoke run also needs `APP_URL`, `BRAND_NAME`, `BRAND_DOMAIN`, `DATABASE_URL`, `SESSION_COOKIE_SECRET` set (dummy values are fine) or `getEnv()` fails.

---

## 5. Known gaps and deferred decisions (carry forward)

Canonical detail is in `USER-FLOWS.md` §9. Short version:

1. **Seeker/Insider profile fields are thinner than `PRD.md` R4.** `seeker_profiles` has only `full_name`; `insider_profiles` has company/work-email/verification/`available`/`weekly_limit`. City, domain, target companies, seniority, vouch roles, bio: not in the schema.
2. **Interview confirmation and disputes — unreconciled TRD-vs-code gap. Now also blocks tranche 2.** `TRD.md` §6.1 describes `INTERVIEW_REPORTED`/`DISPUTED` and `declineAfterReview`; none exist in `src/modules/requests/state.ts` (11 states, no dispute step). Rewards' tranche 2 (`computeTranchePoints(..., 2)`, `releaseTranche`) is fully built and tested but has no caller, because nothing decides when an interview is confirmed. Whoever builds interview confirmation must decide: the simpler single-timer version, or extend the state machine first — then wire tranche 2 through `applyTransition.trancheRelease`, the same way tranche 1 is wired in `reviewProof`. **Not decided.**
3. **`rewards` module is done** (was item 3 here; see §1). No longer blocks `/insider/rewards` or `/admin/redemptions` at the backend level — both still need their frontend.
4. **`admin_audit_log` mandatory-write is per-call-site, not type-enforced.** `applyTransition`'s `adminAudit` is optional; a future admin mutation could forget it and still compile. Add an `applyAdminTransition` with a required field before more admin actions.
5. **Weekly Insider capacity limits are tracked but not enforced.** Needs the `insider.weeklyReset` cron and an enforcement design first.
6. **`authorize.ts` has no `insiderRequest` resource type**, and `submitProof`/`reviewProof`/`requestRedemption` take no actor identity. All must change when server actions wire these modules up.
7. **No adapter contract tests** (`RUN_VENDOR_TESTS=1` fake/real parity suite from AGENTS.md §3.8) — each module instead got its own bespoke opt-in live test (notifications, rewards). Works, but isn't the systematic contract suite the spec describes.
8. **Notifications hard gate and rewards follow-ups** — see §1. Timers follow-ups are in the Timers plan doc; read it before touching `requests.ts` sweep/expire again.

---

## 6. How this project is run

Every piece of backend work follows the AGENTS.md Part 6 loop:

1. Research the current code directly (read files; don't trust memory or old docs).
2. Write a plan to `docs/superpowers/plans/YYYY-MM-DD-<topic>-plan.md` (exact code, no placeholders); commit plan docs straight to `main`.
3. Create an isolated worktree off **local** `main` with manual `git worktree add .worktrees/<name> -b <name>` — the native `EnterWorktree` default branches from `origin/main`, which is far behind local `main`.
4. `npm install`, copy `.env.local`, verify a clean baseline (`npm test`, `npm run lint`, `npm run typecheck`).
5. Run `superpowers:subagent-driven-development` against the plan: one implementer per task → task reviewer (spec + quality) → fix loop (max 5 rounds) → whole-branch final review on opus → one fix wave → `superpowers:finishing-a-development-branch`.
6. **The final whole-branch review has caught a real, load-bearing bug in most plans executed so far** (rewards' final review found none blocking — 0 Critical/Important — likely because per-task opus reviews on the money-critical tasks and a live test already caught the sharp edges before the final pass). Don't skip it or its fix wave.

SDD scripts live at `C:\Users\dml-anmol\.claude\plugins\cache\claude-plugins-official\superpowers\6.4.1\skills\subagent-driven-development\scripts\` (`task-brief PLAN N`, `review-package PLAN BASE HEAD`, `sdd-workspace PLAN`). The version segment changes when the plugin updates; check the directory.

**Model tiers and cost (Anmol's standing preference, 2026-09-25):**

- Implementers on **sonnet** (haiku takes more turns and saves little). Reviewers on **sonnet** for small/mechanical diffs; **opus** only for the final whole-branch review and *subtle-logic* tasks. Always pass `model` explicitly.
- **"Subtle" is defined, not judged per task:** opus for anything touching money, state transitions, idempotency, concurrency or message sending. Sonnet for templates, adapter fakes, wiring, docs. Write the tier for each task into the plan, in a table if the plan has many tasks. The rewards plan's table (§1) is a good template: 4 of 7 tasks (schema/tranche-release, redemption locking, the rewards module, admin wiring) went to opus; the rest to sonnet.
- Hand briefs, reports and diffs over as file paths; never paste them. No prior-task summaries in new dispatches.
- **Put known pitfalls in the brief up front** so they never become fix rounds — e.g. rewards Task 4's brief named the `brand` payload-field-vs-config-object clash and the HTML-only-escaping rule up front, and it landed with zero review findings.
- **Carry hardening forward explicitly.** When an opus review on one task finds a Minor that the next task's code will also touch (rewards Task 2 → Task 3: lock ordering, single-currency assertion, an unvalidated caller-supplied id), name it as a required carried item in the next task's dispatch, with a test. Don't leave it to "the final review will catch it."
- **Reviewers write the full review to a file** and return only the verdict plus one-line findings. Same for implementers: full report to a file, return status, commit, one-line test summary, concerns.
- Fix rounds: covering tests only, full suite once before the commit; one fix, one dispatch; every fix still gets a scoped re-review (cheap tier). Batch only same-shape, low-risk edits — don't batch anything that widens the review surface (e.g. touching ledger-adjacent code).
- **Never skip the final whole-branch review on opus.** It is the only whole-branch check, and it's also where cross-task carried-hardening gets audited for regressions (rewards' final review explicitly re-verified Task 2's carried fixes were still intact after Tasks 3/5/6 built on top).
- If a subagent stalls or the session itself errors out mid-task (rate limit, crash) with no commit, check the worktree's real state (`git status`, `git log`) before doing anything — if nothing was committed, discard any partial uncommitted files and redispatch fresh rather than trying to resume a dead subagent process. Bounded waits, no polling. Start a new session for a new feature (e.g. frontend) rather than growing this one.

Ledger rule: each plan's ledger is `.superpowers/sdd/<plan-basename>/progress.md` in its worktree. A `Task N: complete` line means done — do not re-dispatch. The ledger is deleted after a clean final review.

---

## 7. Lessons that cost time — don't repeat

- **Fakes and mock-based tests can't see vendor-library validation.** A bug in the real pg-boss adapter (undefined-valued option keys) passed 391 tests, two reviews and a final review, and only showed up when a send was run against real Postgres + pg-boss. Any change to `queue.real.ts` / `db/real.ts` needs one live run before merge — every module since (notifications hardening, rewards) has shipped its own opt-in `*.live.test.ts` file for exactly this reason, and it has caught nothing further since, which is itself the payoff of having it.
- `.env.local` is missing in fresh worktrees, and Docker Desktop is not reliably running at the start of a session — check both before a live-test task.
- Merging a worktree can double test counts if `.worktrees/**` isn't excluded from `vitest.config.ts` and `eslint.config.mjs` (it is now).
- **Idempotency keys must embed the entity id** (`send:`, `request:{id}:{event}`, `proof:{requestId}:{key}`, `review:{requestId}:{key}`, `notify:{notificationId}`, `request:{id}:tranche:{n}`, `redemption:{id}:hold/fulfil/reject`). This bug class appeared repeatedly across modules — check it explicitly in every review.
- **"Get the current X for Y" queries must `ORDER BY createdAt DESC`** or they return the oldest row.
- pg-boss v12 needs `createQueue` before `send`/`work`/`schedule` — only visible against real pg-boss, not the fake.
- `server-only` throws under vitest (aliased to `vitest.server-only-shim.ts`); the worker can't import `server-only` modules (hence `adapters.impl.ts`).
- **Plan text isn't gospel.** The notifications plan mandated raw HTML interpolation of user values in email (an injection hole) and excused a missing already-sent guard on a message send; reviewers flagged both. Tell reviewers plan-mandated defects still count, and put exact fix instructions in the fix message to save a round.
- **Locking money code needs an explicit, stated isolation-level assumption**, not just a working test. The rewards final review required naming READ COMMITTED explicitly in a code comment next to every overspend-style lock — the check is only correct at that isolation level, and nothing in the code enforces it.
- Implementer subagents can stall (stream watchdog, 600 s of no progress) or a session can hit a rate limit mid-task with no commit made. Either way: verify the worktree's actual state (`git status`, `git log`, run the focused tests) before re-dispatching. If nothing was committed, discard any uncommitted partial files and redispatch fresh rather than trying to resume a subagent whose process is gone.
- `git worktree remove` can leave the directory behind with "Permission denied" if the shell cwd is inside it; the worktree is still deregistered — just `rm -rf` the leftover directory from outside it.
- The shell cwd can end up inside a worktree. Use absolute paths, and never run shared-checkout git from inside a worktree.
- Never use bare `git stash` — the stash stack is shared across worktrees and sessions.
- Don't use `ScheduleWakeup` outside `/loop`.

---

## 8. Definition of "version 1"

The user wants the final commit, when everything in AGENTS.md is done, tagged/committed as **version 1**. That is far off (see §3). Do not tag it early.

---

## 9. Paste-ready prompt for the new session

Copy everything between the lines into the new session. It asks Anmol to choose the next step rather than assuming one, since Phase 1 backend, the notifications hard gate, and the frontend are all plausible next moves.

```
Continue GetNudgd. First read C:\Users\dml-anmol\Claude\Caveman\getnudgd\SESSION-HANDOFF.md
fully, then AGENTS.md, and node_modules/next/dist/docs/ before any Next.js code.

Situation: main has Phase 0, Phase 1 Identity/Insiders/Requests/Proof/Timers, notifications
(plus hardening and a queue hotfix), and the rewards module — all merged, lint/typecheck
clean, 492 tests passing + 12 skipped (opt-in live tests, both re-verified passing on
2026-09-28). Nothing is in flight, nothing is pushed, no worktrees exist. PRD.md, TRD.md,
USER-FLOWS.md are untracked; do not commit them unless Anmol says so.

Do this, in order:
1. Verify: `git status --short`, `git log --oneline -5`, `git worktree list`. ListAgents
   to make sure no other session is working in this repo. Confirm Docker Desktop is running
   before anything that needs Postgres (it has not reliably been running at session start).
2. Ask Anmol which of these three is next (SESSION-HANDOFF §0 lays out the tradeoffs) — do
   not assume:
   a. Playwright critical-flow tests (closes out AGENTS.md's Phase 1 backend backlog: send
      -> accept -> proof -> verify -> interview; send -> decline -> refund; send -> expiry
      -> refund).
   b. Start the frontend — zero real screens exist yet for any backend module built so far.
   c. Close the notifications `singletonKey`-does-not-dedupe hard gate (SESSION-HANDOFF §1)
      before any real EmailSender/WhatsAppGateway or worker-concurrency change.
   d. Something else Anmol has in mind (e.g. deciding the interview-confirmation design so
      rewards' tranche 2 can be wired — SESSION-HANDOFF §5 item 2).
3. Whichever is chosen: superpowers:brainstorming (if it's new design work) -> spec in
   docs/superpowers/specs/ -> superpowers:writing-plans -> plan in docs/superpowers/plans/,
   commit both to main. Worktree off LOCAL main (manual `git worktree add`), copy .env.local,
   verify baseline, then superpowers:subagent-driven-development. Models, set explicitly per
   task in the plan: implementers sonnet; reviewers sonnet for small/mechanical diffs, opus
   for money/state-transition/idempotency/concurrency/message-sending tasks and the final
   whole-branch review. Pass briefs/reports/diffs as file paths, never pasted. Put known
   pitfalls in each brief up front; carry any hardening one task's review finds forward into
   the next task explicitly, with a test.
4. Any change to a real adapter (`*.real.ts`) needs its own opt-in `*.live.test.ts` against
   the dev Postgres before merge — fakes can't catch vendor-library validation bugs.
5. When done: final whole-branch review on opus, one fix wave if needed, one scoped
   re-review, finishing-a-development-branch with a MERGE COMMIT into main, re-run
   lint/typecheck/tests (and any live tests touched) on main, DO NOT PUSH, remove the
   worktree, delete the branch, update SESSION-HANDOFF.md and commit it.

Stop and ask Anmol only for irreversible or security-sensitive actions, or if the plan is
broken so every path forward is a guess. End by telling him the final main SHA and whether
the working tree is clean.
```
