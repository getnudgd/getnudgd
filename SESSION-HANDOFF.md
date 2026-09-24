# GetNudgd — Session Handoff (rewritten 2026-09-25, after the notifications-module merge)

Written for a fresh Claude Code session (or Anmol) picking this up cold. Read this first, then `AGENTS.md` (the binding engineering spec), then `USER-FLOWS.md` (page-by-page UX reference) if you need product/UX detail. `PRD.md`/`TRD.md` are the requirements docs those draw from.

This file replaces the 2026-09-24 version, which said the notifications module was in flight. It is now merged.

---

## 0. TL;DR — where things stand

- `main` has everything through **Phase 1 Timers**, the **notifications module** and the **notifications hardening** work. Merge commits: notifications `ea8c24d`, queue hotfix `1be49d3`, hardening `f298daa` (all `--no-ff`). The handoff commit sits on top.
- **Nothing is in flight.** All notifications worktrees and branches are gone. No pending worktrees.
- **Nothing has been pushed.** `origin/main` is far behind local `main` and stays that way until Anmol says to push.
- Verified on `main` after the hardening merge: `npm run lint` clean, `npm run typecheck` clean, `npm test` 46 files passed + 1 skipped (412 tests passed, 4 skipped — the opt-in live test), and the live test 4/4 against the dev Postgres.
- Untracked and deliberately not committed (waiting for Anmol to say so): `PRD.md`, `TRD.md`, `USER-FLOWS.md`.

**The exact next step:** start the `rewards` module (Phase 1 backend, next after notifications). Run `superpowers:brainstorming` → spec in `docs/superpowers/specs/` → plan in `docs/superpowers/plans/` → worktree → subagent-driven-development. Before brainstorming, ask Anmol for the placeholder-worthy values (tranche split, minimum redemption, PAN threshold): they live in `app_config`, never in code (AGENTS.md §0.5). Do **not** wire any real `EmailSender` or `WhatsAppGateway` until the `singletonKey`-does-not-dedupe hard gate in §1 is done.

---

## 1. Notifications module — done, and what it left behind

Spec: `docs/superpowers/specs/2026-09-24-notifications-module-design.md`. Plan: `docs/superpowers/plans/2026-09-24-notifications-module-plan.md` (its last section, "Final review findings and deferred follow-ups", is the canonical follow-up list).

What is on `main` now:

| Piece | Where |
|---|---|
| `SendOptions.retryLimit` / `retryBackoff` on the queue client | `src/jobs/queue.ts`, `queue.real.ts` |
| `WhatsAppGateway` interface + configurable fake | `src/adapters/whatsapp/` |
| `users.phone`, `notifications` table, `Database.notifications.{create,getById,markSent,markFailed}`, `identity.{getSeekerProfileById,setUserPhone}`, migration `0009_notifications_and_phone.sql` | `drizzle/`, `src/adapters/db/` |
| Template registry (5 templates; email HTML escapes user values, subjects stay plain text) | `src/modules/notifications/templates.ts` |
| `notify()` (validate → row → enqueue `notify.send`, key `notify:{notificationId}`) and `deliverNotification()` (session msg → template msg → email fallback; already-`sent` rows are skipped; all-channels-fail marks `failed` and rethrows) | `src/modules/notifications/notifications.ts` |
| `notify()` wired into accept / decline / expire (`requests.ts`) and proof verified (Insider + Seeker) / proof rejected (`admin.ts`); each call is try/catch'd so a notification failure never fails the mutation; `AdminDeps` now requires `queue` | `src/modules/requests/`, `src/modules/admin/` |
| Worker `notify.send` handler; `Adapters.whatsapp` | `src/jobs/worker.ts`, `src/lib/adapters.impl.ts` |

Migration `0009` was checked by inspection (matches `schema.ts` and the snapshot, no trigger/REVOKE on `notifications`, `db:generate` reports no changes) **and applied to the dev Postgres on 2026-09-25**. A live end-to-end run (real Postgres + real pg-boss, fake email/WhatsApp) passed: accept and decline each produced a `notifications` row that went `pending` → `sent` on the `email` channel via the real worker handler, and pg-boss stored `retry_limit 3`, `retry_backoff true`, singleton key `notify:{id}`. Not covered live: the failure paths (all-channels-fail retry/backoff, already-sent skip), the WhatsApp branches, and real vendor delivery (email/WhatsApp are still fakes).

**Live run found a merged regression, fixed in `1be49d3`:** Task 1 (`d9a63f8`) made `queue.real.ts` `send()` pass `retryLimit`/`retryBackoff` as keys with value `undefined`. pg-boss validates with `'retryLimit' in config`, so every send without retry options threw, and `sendRequest`'s `request.expire` job (the 48h timer) was never enqueued on a real queue (only the hourly sweep would have expired requests). Fakes and reviews missed it. `send()` now includes an option key only when set, with a unit test (mocked `PgBoss`) asserting key absence. Re-verified live: `request.expire` jobs are created with `start_after` ≈ 48h ahead.

### Hard-gate follow-ups: what is closed, what is still open

Closed by the `notifications-hardening` branch (merge `f298daa`, plan `docs/superpowers/plans/2026-09-25-notifications-hardening-plan.md`, migration `0010`, applied to the dev DB):

- **Event-derived idempotency.** `notifications.idempotency_key` (unique); `notify(deps, userId, template, payload, eventKey)` composes `{eventKey}:{template}:{userId}` and returns without enqueueing when the row already exists, so a racing replay of accept/decline/expire/reviewProof cannot re-notify. `db.notifications.create` returns `{ record, created }`.
- **Pending sweep.** `sweepPendingNotifications` (worker queue `notifications.sweep`, cron every 15 min) re-enqueues rows still `pending` after 30 min.
- **Failure bookkeeping.** Missing user / unknown template / unparseable stored payload → row `failed` with a message, no retry; all channels failing → row `failed` with every channel's cause, still rethrows. `markSent` clears a stale `error`.
- **Live integration test.** `src/modules/notifications/notifications.live.test.ts`, opt-in (`RUN_VENDOR_TESTS=1`), runs the real `Database` notification methods and real pg-boss `send` against the dev Postgres: `export $(grep -v '^#' .env.local | grep -v '^$' | xargs -d '\n'); npm run db:migrate; RUN_VENDOR_TESTS=1 npx vitest run src/modules/notifications/notifications.live.test.ts` (4 passing on 2026-09-25). **Do not export `.env.local` when running the full `npm test`** (`ADAPTERS=real` makes `src/config/env.test.ts` fail).

**Still a HARD GATE before any real EmailSender / WhatsAppGateway is wired, or any worker concurrency increase:** the `notify:{id}` `singletonKey` does NOT dedupe on pg-boss's default `standard` queue policy. Double delivery is prevented today only by a single worker running one job at a time plus `deliverNotification`'s `status === "sent"` guard. Add either an atomic claim (`UPDATE notifications SET status='sending' WHERE id=$1 AND status IN ('pending','failed') RETURNING`) or a deduplicating queue policy (policy is set at queue creation, so it needs a new queue name on existing databases).

Also open (recorded in the hardening plan's last section): a notification is lost if `notifications.create` fails or the process dies after the transition commits (fix: write the notification row inside the `applyTransition` transaction when real adapters land); the sweep re-enqueues the same oldest 100 rows if more than 100 stay pending forever and has no partial index `(created_at) WHERE status='pending'`; a few test-quality minors.

### Before launch

- Real Brevo `EmailSender` and real `WhatsAppGateway`. Until then the fakes are used even under `ADAPTERS=real`, so rows get `status=sent` with nothing delivered, and the fake email `sent` array grows without bound in a long-running worker (it holds recipient addresses and HTML).
- The Brevo adapter must strip CR/LF from `subject` (it contains user-controlled `seekerName`), and its error text must not contain the API key.
- Nothing writes `users.phone` yet, so the WhatsApp branch is unreachable; every notification goes to email.

### Smaller deferred items

- Refund formula `Math.round(creditCost * pct / 100)` is duplicated in `requests.ts` (`refundEntries` and the decline/expire notify blocks). Extract a `refundAmountFor` helper so ledger and email copy cannot drift.
- When Seeker onboarding lands, require `fullName` `min(1)` + trim in the profile schema. An empty `fullName` makes `proof.verified` (Insider) and `proof.rejected` notifications fail Zod and be dropped with only a `console.error`.
- `templates.test.ts` asserts the literal `/GetNudgd/` instead of `brand.name`; `retryLimit: 3` in `notifications.ts` is a literal (make it a named constant); real `markSent`/`markFailed` no-op on a missing id while the fake throws (existing repo pattern).
- Out of scope by design: literal 15-minute delivery-confirmation email fallback (falls back to email immediately on any WhatsApp failure), trigger events beyond the 5, admin UI for failed notifications.

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
| **Notifications** (merge `ea8c24d`) | See §1. Follow-ups: the last section of the notifications plan. |
| **Queue hotfix** (merge `1be49d3`) | `queue.real.ts` omits unset pg-boss options (found by the first live run). |
| **Notifications hardening** (merge `f298daa`) | Event-derived notification idempotency (migration `0010`), pending sweep, failure bookkeeping, opt-in live integration test. See §1. |

**Migrations on `main`:** `0000`–`0010`.

---

## 3. Overall completion estimate

**Roughly 30% done.**

- **Backend:** Phase 0 complete. Phase 1: identity, insiders search, resume upload registration, send-request + escrow, accept/decline/expire, proof + admin verify, timers and notifications are done. Still open in Phase 1: `rewards` on the manual vendor, Playwright flows. Phase 2 and 3: nothing started.
- **Frontend:** only Phase 0 scaffolding (primitives, role-scoped shells, brand wiring). **Zero real screens** — `app/seeker/`, `app/insider/`, `app/(admin)/admin/` each contain only a `layout.tsx`.
- **Real vendor adapters:** only `db` (Postgres/Drizzle) and `queue` (pg-boss). Firebase Auth, Cloud Storage, Brevo, WhatsApp BSP, OpenAI, Razorpay, gift-card vendor are fake-only.
- **Infra/deploy:** local Docker dev works. VPS, Caddy, CI→deploy pipeline: not started.

Method: raw item counts from AGENTS.md §3.11/§4.9, weighted down because the frontend and every real vendor integration are untouched and no deploy work has happened. A directional gut-check, not a burn-down.

---

## 4. Local dev environment (Docker/Postgres)

- Docker Desktop is a user-local install, **not on PATH**: `C:\Users\dml-anmol\AppData\Local\Programs\DockerDesktop\resources\bin` (`docker.exe`, `docker-compose.exe`).
- On 2026-09-24 ~23:30 the Docker daemon was not reachable. Start Docker Desktop, then `docker compose -f infra/compose.dev.yml up -d` (Postgres 16 on 5432, Gotenberg on 3050). The volume `infra_getnudgd-postgres-data` persists across stops.
- Module tests run on fakes and need no Postgres. Start it to apply migration `0009` (and the future `0010`) and to check `real.ts` against a real database — still unverified for the notifications methods.
- `.env.local` at the repo root is git-ignored and **does not propagate to new worktrees** — copy it in. Standalone `tsx` scripts need its variables exported:
  ```bash
  export $(grep -v '^#' .env.local | grep -v '^$' | xargs -d '\n')
  ```
  The worker smoke run also needs `APP_URL`, `BRAND_NAME`, `BRAND_DOMAIN`, `DATABASE_URL`, `SESSION_COOKIE_SECRET` set (dummy values are fine) or `getEnv()` fails.

---

## 5. Known gaps and deferred decisions (carry forward)

Canonical detail is in `USER-FLOWS.md` §9. Short version:

1. **Seeker/Insider profile fields are thinner than `PRD.md` R4.** `seeker_profiles` has only `full_name`; `insider_profiles` has company/work-email/verification/`available`/`weekly_limit`. City, domain, target companies, seniority, vouch roles, bio: not in the schema.
2. **Interview confirmation and disputes — unreconciled TRD-vs-code gap.** `TRD.md` §6.1 describes `INTERVIEW_REPORTED`/`DISPUTED` and `declineAfterReview`; none exist in `src/modules/requests/state.ts` (11 states, no dispute step). Whoever builds interview confirmation must decide: the simpler single-timer version, or extend the state machine first. **Not decided.**
3. **`rewards` module doesn't exist.** Blocks `/insider/rewards` and `/admin/redemptions`. **This is the next Phase 1 backend item.**
4. **`admin_audit_log` mandatory-write is per-call-site, not type-enforced.** `applyTransition`'s `adminAudit` is optional; a future admin mutation could forget it and still compile. Add an `applyAdminTransition` with a required field before more admin actions.
5. **Weekly Insider capacity limits are tracked but not enforced.** Needs the `insider.weeklyReset` cron and an enforcement design first.
6. **`authorize.ts` has no `insiderRequest` resource type**, and `submitProof`/`reviewProof` take no actor identity. Both must change when server actions wire these modules up.
7. **No adapter contract tests** (`RUN_VENDOR_TESTS=1` fake/real parity suite from AGENTS.md §3.8).
8. **Notifications gate and follow-ups** — see §1. Timers follow-ups are in the Timers plan doc; read it before touching `requests.ts` sweep/expire again.

---

## 6. How this project is run

Every piece of backend work follows the AGENTS.md Part 6 loop:

1. Research the current code directly (read files; don't trust memory or old docs).
2. Write a plan to `docs/superpowers/plans/YYYY-MM-DD-<topic>-plan.md` (exact code, no placeholders); commit plan docs straight to `main`.
3. Create an isolated worktree off **local** `main` with manual `git worktree add .worktrees/<name> -b <name>` — the native `EnterWorktree` default branches from `origin/main`, which is far behind local `main`.
4. `npm install`, copy `.env.local`, verify a clean baseline (`npm test`, `npm run lint`, `npm run typecheck`).
5. Run `superpowers:subagent-driven-development` against the plan: one implementer per task → task reviewer (spec + quality) → fix loop (max 5 rounds) → whole-branch final review on opus → one fix wave → `superpowers:finishing-a-development-branch`.
6. **The final whole-branch review has caught a real, load-bearing bug in every plan executed so far** (the notifications one found none blocking, but did force the follow-up gate in §1). Don't skip it or its fix wave.

SDD scripts live at `C:\Users\dml-anmol\.claude\plugins\cache\claude-plugins-official\superpowers\6.4.1\skills\subagent-driven-development\scripts\` (`task-brief PLAN N`, `review-package PLAN BASE HEAD`, `sdd-workspace PLAN`). The version segment changes when the plugin updates; check the directory.

**Model tiers and cost (Anmol's standing preference, 2026-09-25):**

- Implementers on **sonnet** (haiku takes more turns and saves little). Reviewers on **sonnet** for small/mechanical diffs; **opus** only for the final whole-branch review and *subtle-logic* tasks. Always pass `model` explicitly.
- **"Subtle" is defined, not judged per task:** opus for anything touching money, state transitions, idempotency, concurrency or message sending. Sonnet for templates, adapter fakes, wiring, docs. Write the tier for each task into the plan. Evidence (notifications plan): the opus reviews on logic-heavy tasks caught the missing already-sent guard and the replay-duplicate race; sonnet was enough for mechanical diffs.
- Hand briefs, reports and diffs over as file paths; never paste them. No prior-task summaries in new dispatches.
- **Put known pitfalls in the brief up front** so they never become fix rounds: escape user values in email HTML but keep subjects plain text; any message send needs an already-sent guard; every mutation that notifies must swallow notify errors and have a test proving it. Exact fix instructions shorten a round; known pitfalls in the brief prevent it.
- **Reviewers write the full review to a file** and return only the verdict plus one-line findings (their long reports land in the controller's context too). Same for implementers: full report to a file, return status, commit, one-line test summary, concerns.
- Fix rounds: covering tests only, full suite once before the commit; one fix, one dispatch; every fix still gets a scoped re-review (cheap tier). Batch only same-shape, low-risk edits — don't batch anything that widens the review surface (e.g. touching ledger-adjacent code).
- **Never skip the final whole-branch review on opus.** It is the only whole-branch check.
- If a subagent stalls, check the worktree's real state and re-dispatch only what remains. Bounded waits, no polling. Start a new session for a new feature (e.g. frontend) rather than growing this one.

Ledger rule: each plan's ledger is `.superpowers/sdd/<plan-basename>/progress.md` in its worktree. A `Task N: complete` line means done — do not re-dispatch. The ledger is deleted after a clean final review.

---

## 7. Lessons that cost time — don't repeat

- **Fakes and mock-based tests can't see vendor-library validation.** A bug in the real pg-boss adapter (undefined-valued option keys) passed 391 tests, two reviews and a final review, and only showed up when a send was run against real Postgres + pg-boss. Any change to `queue.real.ts` / `db/real.ts` needs one live run before merge: `docker compose -f infra/compose.dev.yml up -d postgres`, `npm run db:migrate`, `npm run db:seed`, then a small tsx script driving real db + real queue (`startWorker` + `sendRequest`/`accept`/`decline`) and checking rows and `pgboss.job`. Put that in the plan's verification step, not after the merge. Still missing: an automated integration suite for this (AGENTS.md §3.8 contract tests).

- `.env.local` is missing in fresh worktrees.
- Merging a worktree can double test counts if `.worktrees/**` isn't excluded from `vitest.config.ts` and `eslint.config.mjs` (it is now).
- **Idempotency keys must embed the entity id** (`send:`, `request:{id}:{event}`, `proof:{requestId}:{key}`, `review:{requestId}:{key}`, `notify:{notificationId}`). This bug class appeared twice. The notification row itself is now keyed on the triggering event (`{eventKey}:{template}:{userId}`); the job `singletonKey` embeds the notification id but does not dedupe on pg-boss `standard` queues (§1 hard gate).
- **"Get the current X for Y" queries must `ORDER BY createdAt DESC`** or they return the oldest row.
- pg-boss v12 needs `createQueue` before `send`/`work`/`schedule` — only visible against real pg-boss, not the fake.
- `server-only` throws under vitest (aliased to `vitest.server-only-shim.ts`); the worker can't import `server-only` modules (hence `adapters.impl.ts`).
- **Plan text isn't gospel.** The notifications plan mandated raw HTML interpolation of user values in email (an injection hole), excused a missing already-sent guard on a message send, and contained a brief step that contradicted itself. Reviewers flagged all three; the fix took a round each. Tell reviewers plan-mandated defects still count, and put exact fix instructions in the fix message ("subject stays plain text, only the HTML body is escaped" would have saved a round).
- Implementer subagents can stall (stream watchdog, 600 s of no progress). Verify the worktree's actual state (`git status`, run the focused tests) before re-dispatching, and tell the fresh agent which steps are already verified.
- `git worktree remove` can leave the directory behind with "Permission denied" if the shell cwd is inside it; the worktree is still deregistered — just `rm -rf` the leftover directory from outside it.
- The shell cwd can end up inside a worktree. Use absolute paths, and never run shared-checkout git from inside a worktree.
- Never use bare `git stash` — the stash stack is shared across worktrees and sessions.
- Don't use `ScheduleWakeup` outside `/loop`.

---

## 8. Definition of "version 1"

The user wants the final commit, when everything in AGENTS.md is done, tagged/committed as **version 1**. That is far off (see §3). Do not tag it early.

---

## 9. Paste-ready prompt for the new session

Copy everything between the lines into the new session.

```
Start the `rewards` module for GetNudgd (Phase 1 backend, next after notifications).

First read C:\Users\dml-anmol\Claude\Caveman\getnudgd\SESSION-HANDOFF.md fully, then
AGENTS.md (Part 0, 2, 3 — especially 0.5 config-not-code, 3.2 rewards, 3.3 ledger rules)
and node_modules/next/dist/docs/ before any Next.js code.

Situation: main has everything through Phase 1 Timers and the notifications module
(merge ea8c24d) and the hardening branch (merge f298daa), lint/typecheck clean, 412 tests passing + 4 skipped live tests. Nothing is in flight, nothing
is pushed, no worktrees exist. PRD.md, TRD.md, USER-FLOWS.md are untracked; do not commit
them unless I say so.

Do this, in order:
1. Verify: `git status --short`, `git log --oneline -5`, `git worktree list`. ListAgents
   to make sure no other session is working in this repo.
2. superpowers:brainstorming for the rewards module (points issuance per tranche,
   redemption requests, PAN gate, manual gift-card vendor). Ask me for the business
   numbers it needs (tranche split, minimum redemption, PAN threshold); they go in
   app_config as `placeholder: true` seeds, never in code. Settle the open TRD-vs-code
   gap on interview confirmation/disputes (SESSION-HANDOFF §5.2) if rewards depends on it.
   Spec -> docs/superpowers/specs/, then superpowers:writing-plans -> docs/superpowers/plans/,
   commit both to main.
3. Worktree off LOCAL main (manual `git worktree add`), copy .env.local, verify baseline,
   then superpowers:subagent-driven-development. Models, set explicitly: implementers
   sonnet; reviewers sonnet for small diffs, opus only for the final whole-branch review and
   money/concurrency-subtle tasks. Pass briefs/reports/diffs as file paths.
4. Do NOT wire a real EmailSender or WhatsAppGateway; the remaining notifications hard gate in
   SESSION-HANDOFF §1 (atomic claim or dedup queue policy for notify.send) comes first.
5. When done: final review, finishing-a-development-branch with a MERGE COMMIT into main,
   re-run lint/typecheck/tests on main, DO NOT PUSH, remove the worktree, delete the
   branch, update SESSION-HANDOFF.md and commit it.

Stop and ask me only for irreversible or security-sensitive actions, or if the plan is
broken so every path forward is a guess. End by telling me the final main SHA and whether
the working tree is clean.
```
