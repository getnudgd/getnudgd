<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# AGENTS.md — GetNudgd engineering guide for AI agents

> Read this file completely before touching any file. It tells you what GetNudgd is, what already exists, the architecture you are building toward, the rules for backend and frontend work, and the subagent process used to execute plans.

---

## Part 0. Orientation

### 0.1 What GetNudgd is

A two-sided marketplace for Indian job seekers, web-first, WhatsApp as the entry funnel.

- **Seekers** upload a resume, get a free AI-tailored ATS-friendly resume for a job post, and spend purchased **credits** to send an **Insider Request** to a verified employee at a target company.
- **Insiders** verify with their company email, accept or decline requests within 48 hours, submit the candidate internally, upload proof, and earn **points** in two tranches, redeemable for gift cards.
- **Admin** (the founder) verifies proofs, grants credits, reviews flags, and reconciles redemptions from `/admin`.

### 0.2 Project facts

| Fact | Value |
|---|---|
| Brand | **GetNudgd** (getnudgd.com). Older docs say "Referly"; that is outdated. Never hard-code the brand; use `src/config/brand.ts`. |
| Stage | Pre-launch. Only the landing page and survey exist. No auth, no database, no backend. |
| Repo | This repo. Next.js 16 App Router, React 19, TypeScript, Tailwind 4. |
| Deployment target | GCP managed services for state + one VPS running Docker Compose for compute. |
| Founder / operator | Anmol. Solo. Every manual ops action must be possible from `/admin`. |
| Plan of record | `2026-09-19-architecture-and-development-plan.md` in the product vault (`C:\Users\dml-anmol\Documents\Claude\Projects\Refer\02_GetNudgd_New`). This AGENTS.md is a compiled, agent-facing version of it. |

### 0.3 Source-of-truth order

When documents disagree, the higher one wins:

1. Explicit instruction from the founder in the current session.
2. This `AGENTS.md`.
3. The architecture plan in the vault (dated 2026-09-19).
4. `referly-page-by-page-flow.md` and `referly-insider-user-journey.md` in the vault (screen fields, validation, states; brand name in them is outdated).
5. Everything else in the vault is historical context only. In particular, the vault `CLAUDE.md` (Aug 2026) is outdated on brand (says Referly), hosting (says Vercel + Supabase), and framework version (says Next 14).

### 0.4 Locked vocabulary

Use these words in code, schema, copy, and commit messages. Never the old ones.

| Use | Never |
|---|---|
| Insider | referrer, referral giver, champion |
| Seeker | job seeker (in identifiers) |
| Insider Request, `insider_requests` | referral request, `referral_requests` |
| vouch (verb) | refer |
| Insider Rewards, points, `insider_rewards` | payout, `payouts` |
| credits (Seeker currency) | coins, tokens |
| "Get vouched in" (CTA) | "Get referred" |

### 0.5 Business numbers are configuration, never code

Credit pack sizes and prices, request cost per company tier, refund percentages, tranche split, response window, interview window, re-verification cadence, minimum redemption, PAN threshold, free-credit grant: all of these live in the `app_config` table and are loaded through `src/modules/config`. Each `insider_requests` row stamps the `rules_version` it was created under. If you find yourself typing `0.7` or `48` or `200` into a domain module, stop and read it from config.

The founder supplies the values. Until then, seed placeholders and mark them `placeholder: true` in the seed file.

---

## Part 1. Architecture you are building

### 1.1 Topology

```
Internet ─▶ VPS (Docker Compose)                          GCP
            ├─ caddy      TLS, reverse proxy, headers     ├─ Cloud SQL Postgres 16 (PITR)
            ├─ web        Next.js standalone (app + API)  ├─ Cloud Storage: gn-resumes, gn-proofs, gn-public
            ├─ worker     pg-boss job consumers           ├─ Secret Manager
            ├─ gotenberg  DOCX → PDF                      ├─ Artifact Registry
            └─ cloud-sql-proxy (only if VPS is off-GCP)   ├─ Firebase Auth (email/phone OTP, Google)
                                                          └─ Cloud Logging / Monitoring
External: Razorpay · WhatsApp Cloud API via BSP · OpenAI · Brevo · gift-card vendor (stubbed)
```

`web` and `worker` are the **same Docker image** with different entry points. Business logic exists exactly once, in `src/modules`. The VPS is stateless and disposable; all durable state is in GCP.

### 1.2 Stack (decided)

| Concern | Choice |
|---|---|
| Framework | Next.js 16 App Router, `output: 'standalone'`, TypeScript `strict` |
| Styling | Tailwind 4 + CSS variables (design tokens in `app/globals.css`) |
| Database | Cloud SQL PostgreSQL 16 via **Drizzle ORM**; SQL migrations in `drizzle/` |
| Auth | **Firebase Authentication** (email OTP/link, phone OTP, Google). Server verifies the ID token once and issues its own HttpOnly session cookie. Company-email OTP for Insiders is our own code. |
| Files | Cloud Storage, private buckets, V4 signed URLs (10-minute TTL). Browser uploads go straight to the bucket. |
| Jobs and timers | **pg-boss** on the same Postgres (delayed jobs, retries, singleton keys, cron) |
| Rendering | `docx` npm builds DOCX from JSON + versioned ATS template; **Gotenberg** converts to PDF |
| LLM | GPT-4o with JSON-schema structured outputs, behind `LLMProvider`; model name and prompt version are config |
| Payments | Razorpay Orders + HMAC-verified webhook + nightly reconciliation job |
| WhatsApp | Meta Cloud API via a BSP (Gupshup), behind `WhatsAppGateway` |
| Email | Brevo transactional, behind `EmailSender` |
| Gift cards | `GiftCardVendor` interface; `ManualFulfilmentVendor` at MVP |
| Secrets | GCP Secret Manager → `.env` on the VPS (never committed) |
| CI/CD | GitHub Actions: lint → typecheck → unit → Playwright smoke → build image → push → SSH deploy → migrate → health gate → rollback |
| Observability | Pino JSON logs → Cloud Logging; Sentry; uptime check on `/api/health`; job dashboard at `/admin/jobs` |
| Testing | Vitest (modules, ledger, state machine); Playwright (three critical flows) |

### 1.3 Target repo layout

```
app/
  (public)/            landing, survey, login, insider landing
  (seeker)/            dashboard, resume/new, resume/[id], insiders, insiders/[id], requests, requests/[id], credits, profile
  (insider)/           dashboard, requests (inbox), requests/[id], rewards, profile
  (admin)/admin/       requests, users, redemptions, flags, jobs, audit
  api/v1/              JSON handlers (bot + future mobile)
  api/webhooks/        razorpay, whatsapp
  api/health/
  globals.css          design tokens
components/            shared UI (existing landing/survey components live here)
src/
  config/              brand.ts, env.ts (Zod-validated), appConfig loader
  modules/             identity, insiders, resumes, requests, ledger, rewards, notifications, whatsapp, admin
  adapters/            db, storage, auth, payments, whatsapp, llm, docgen, giftcards, email  (each: interface + real + fake)
  jobs/                pg-boss job definitions and worker entry (worker.ts)
  lib/                 authorize(), problem-details errors, logger, rate limit
drizzle/               schema.ts, migrations/
infra/                 gcloud/terraform scripts, compose.prod.yml, compose.dev.yml, Caddyfile, Dockerfile
tests/                 unit (Vitest), e2e (Playwright), fixtures
docs/superpowers/      specs/ and plans/ produced by the brainstorming and writing-plans skills
```

Current state to be aware of: `app/page.tsx` is the **survey** and `app/landing/page.tsx` is the landing page. Both move into `app/(public)` during Phase 0 with `/` becoming the landing page. `lib/api-security.ts` and the two existing API routes have known defects (see 2.9) and must be replaced, not extended.

### 1.4 Data model (summary)

Full column list is in the plan §2.6. Tables: `users`, `seeker_profiles`, `companies`, `company_domains`, `target_companies`, `insider_profiles`, `resumes`, `tailored_resumes`, `insider_requests`, `request_events` (append-only), `verification_proofs`, `ledger_accounts`, `ledger_txns`, `ledger_entries` (append-only), `ledger_balances` (materialized view), `credit_packs`, `payments`, `insider_rewards`, `reward_redemptions`, `notifications`, `whatsapp_sessions`, `prefill_tokens`, `admin_audit_log`, `app_config`.

### 1.5 Request state machine

```
SENT ─accept──▶ ACCEPTED ─proof──▶ PROOF_PENDING ─verify──▶ SUBMITTED ─interview──▶ INTERVIEW ──▶ COMPLETE
 │                 ▲                    │                        │
 ├─decline──▶ DECLINED                  └─reject──▶ ACCEPTED     └─window expiry──▶ NO_INTERVIEW ──▶ CLOSED
 ├─48h expiry─▶ EXPIRED
 └─seeker cancel (only while SENT)─▶ CANCELLED
```

One transition table in `src/modules/requests/state.ts`. Every transition writes a `request_events` row and any ledger transaction in the **same database transaction**, then enqueues notifications and timers.

---

## Part 2. Shared engineering rules (backend and frontend)

1. **TypeScript strict, no `any`, no `@ts-ignore`.** Zod at every boundary (env, forms, handlers, webhooks, LLM output).
2. **Domain modules are pure.** `src/modules/*` import no Next.js, no Drizzle client, no vendor SDK. They receive adapters through function arguments or a small `deps` object.
3. **Every vendor is behind an interface with a fake.** Add the fake in the same PR as the interface. Tests and local dev run on fakes.
4. **Idempotency on anything that moves money or sends a message.** Derive the key from the triggering event (`razorpay:{payment_id}`, `request:{id}:expire`).
5. **Append-only tables are append-only.** `request_events`, `ledger_entries`, `admin_audit_log`: no `UPDATE`, no `DELETE`, enforced by grants and by code review.
6. **Secrets never touch the repo, logs, or client bundles.** No `NEXT_PUBLIC_` variable may hold anything secret. `src/config/env.ts` validates all env at boot and fails fast.
7. **No vendor error bodies or debug fields in client responses.** Errors are RFC 7807 problem details with a stable `type` and a user-safe `title`.
8. **Files never pass through the VPS.** Uploads and downloads use signed URLs issued only after `authorize()`.
9. **Tests before implementation** (superpowers:test-driven-development). Money and state-machine code needs exhaustive unit tests; UI needs Playwright for the critical flows.
10. **Small, verified commits** on a feature branch in a worktree. Never commit to `main` directly. Run `npm run lint && npm run typecheck && npm test` before every commit. Commit messages: `type(scope): summary` with scope = module or route group.
11. **Do not add dependencies** without stating why in the PR description. No new UI or animation libraries unless the founder approves (the existing `framer-motion` usage is a Phase 0 decision item).
12. **Locked vocabulary and config-not-code** (0.4, 0.5) apply everywhere.
13. **Verify before claiming done** (superpowers:verification-before-completion): run the thing, paste the output, then report.

---

## Part 3. Backend

### 3.1 Scope

Everything under `src/modules`, `src/adapters`, `src/jobs`, `src/lib`, `drizzle/`, `app/api/**`, server actions' domain calls, and `infra/`.

### 3.2 Module responsibilities

| Module | Owns | Public interface (examples) |
|---|---|---|
| `identity` | users, sessions, roles, Firebase token exchange, company-email OTP | `signInWithFirebaseToken`, `startWorkEmailOtp`, `verifyWorkEmailOtp`, `getSessionUser` |
| `insiders` | insider profiles, availability, weekly limit, credit cost, search, re-verification | `listInsiders(filters)`, `getInsider(id)`, `setAvailability`, `scheduleReverify` |
| `resumes` | resume upload records, parse pipeline orchestration, tailored resume lifecycle | `registerUpload`, `requestTailoring`, `getTailoredResume` |
| `requests` | state machine, escrow orchestration, timers, proof, interview confirmation | `sendRequest`, `accept`, `decline`, `expire`, `submitProof`, `verifyProof`, `confirmInterview`, `closeWindow` |
| `ledger` | accounts, zero-sum transactions, balances, idempotency | `post(txn)`, `balance(account)`, `escrowFor(requestId)` |
| `rewards` | points issuance per tranche, redemption requests, PAN gate | `releaseTranche`, `requestRedemption` |
| `notifications` | template registry, channel selection (WhatsApp session vs template vs email fallback), delivery records | `notify(userId, template, payload)` |
| `whatsapp` | inbound session state machine, media intake, prefill tokens | `handleInbound(event)`, `issuePrefillToken` |
| `admin` | verification queue, credit grants, flags, audit log | `grantCredits`, `reviewProof`, `listFlags` |
| `config` | `app_config` loader with versioning and validation | `getRules(version?)`, `getPacks()` |

### 3.3 Ledger rules (non-negotiable)

- One `ledger_txns` row per business event, with a unique `idempotency_key`. Posting the same key twice is a no-op that returns the original transaction.
- Entries in a transaction sum to zero **per currency** (`credits` or `points`). Enforce in code and with a deferred constraint trigger.
- Escrow is a real account per request (`owner_type = escrow`, `owner_id = request_id`).
- Credits flow: purchase `platform(credits) → seeker`; send `seeker → escrow(req)`; outcome `escrow → platform` and/or `escrow → seeker` per the request's `rules_version`.
- Points flow: `platform(points) → insider` on each tranche, referencing the request. Points are never derived from the Seeker's account directly; the ledger keeps the two currencies separate.
- All ledger writes run inside a transaction that first takes `SELECT ... FOR UPDATE` on the affected accounts, or uses `SERIALIZABLE` with retry.
- A nightly `ledger.reconcile` job recomputes balances from entries, compares with the materialized view, and alerts on drift.

### 3.4 Jobs and timers (pg-boss)

| Job | Trigger | Key | Notes |
|---|---|---|---|
| `resume.parse` | upload registered | `resume:{id}` | OpenAI structured output → `resumes.parsed_json` |
| `resume.tailor` | tailoring requested | `tailored:{id}` | parse → JD keywords → rewrite → `docx` → Gotenberg → Storage |
| `request.expire` | request sent, delayed 48h (config) | `request:{id}:expire` | no-op unless still `SENT` |
| `request.windowClose` | proof verified, delayed by interview window | `request:{id}:window` | no-op unless still `SUBMITTED` |
| `insider.reverify` | verified, delayed 90d (config) | `insider:{userId}:reverify` | hides profile if not re-verified |
| `insider.weeklyReset` | cron weekly | singleton | resets weekly counters |
| `notify.send` | any transition | `notify:{notificationId}` | chooses channel, retries with backoff, email fallback after 15 min |
| `payments.reconcile` | cron nightly | singleton | compares `payments` with Razorpay API |
| `ledger.reconcile` | cron nightly | singleton | drift check |
| `requests.sweep` | cron hourly | singleton | catches overdue requests whose timer job was lost |

Rules: every job handler is idempotent and re-checks current state before acting. Jobs never call each other synchronously; they enqueue. Worker concurrency for `resume.tailor` is 2 (Gotenberg memory).

### 3.5 API and webhooks

- Browser mutations use **server actions** that validate with Zod, call `authorize()`, and call one module function.
- `/api/v1/*` JSON handlers exist for the WhatsApp bot and future mobile. Same validation and `authorize()`; accept `Idempotency-Key` on mutations.
- `/api/webhooks/razorpay`: verify HMAC-SHA256 over the raw body; insert raw event keyed by vendor event ID (unique); enqueue; return 200 within 2 s.
- `/api/webhooks/whatsapp`: GET verify-token handshake; POST verify `X-Hub-Signature-256`; same store-and-enqueue pattern.
- `/api/health`: DB ping, Storage ping, queue depth; returns 503 on failure; used by CI deploy gate and Cloud Monitoring.
- Rate limiting: `src/lib/ratelimit.ts` in-process token bucket keyed by user ID and IP (single replica). Interface allows a Redis implementation later.

### 3.6 Authorization

One helper: `authorize(session, action, resource)`. Rules live in `src/lib/authorize.ts` and are unit-tested per denial case:

- Seeker: own profile, own resumes, own requests, own wallet.
- Insider: own profile, requests addressed to them; the attached resume **only while the request is not in a terminal state**.
- Admin: everything, and every admin mutation writes `admin_audit_log`.
- Signed download URLs are issued only after `authorize()` passes.

### 3.7 Database and migrations

- Schema in `drizzle/schema.ts`; generate SQL migrations with drizzle-kit; never edit a migration that has been applied to staging or prod.
- Migrations run as a one-shot container step in the deploy pipeline before `web` starts.
- Local: `docker compose -f infra/compose.dev.yml up` gives Postgres 16 and Gotenberg. Seed script creates placeholder `app_config`, three `credit_packs`, ten `companies` with domains, and fake users for each role.

### 3.8 Backend testing

| Layer | Tool | Requirement |
|---|---|---|
| `ledger`, `requests/state`, `config` | Vitest | 100% branch coverage; property test that random transition sequences never violate zero-sum or reach an invalid state |
| Other modules | Vitest with fakes | Every public function has happy path + each documented failure |
| Adapters | Vitest contract tests | Fake and real implementation pass the same contract suite (real runs only with `RUN_VENDOR_TESTS=1`) |
| Webhooks | Vitest | Signature valid/invalid/replayed |
| Jobs | Vitest | Idempotent re-run leaves state unchanged |
| End to end | Playwright against compose | Flow A: send → accept → proof → verify → interview. Flow B: send → decline → refund. Flow C: send → expiry → refund. |

### 3.9 Known defects to remove in Phase 0

- `lib/api-security.ts`: the "secret" is exposed as `NEXT_PUBLIC_API_SECRET`; the rate limiter is an in-memory `Map`. Delete the file; replace with same-origin checks, a honeypot, and `src/lib/ratelimit.ts`.
- `app/api/waitlist/route.ts` and `app/api/survey/route.ts`: return `_debug` with vendor bodies. Remove.
- `README.md` says Next 14 in places; the real version is in `package.json`.

### 3.10 Backend definition of done (per task)

- [ ] Tests written first and passing; coverage rule for the module met
- [ ] No business number literal; config read through `config` module
- [ ] Idempotency key present on every money or message side effect
- [ ] Errors are problem details; no vendor text leaks
- [ ] Migration generated (if schema changed) and applied locally
- [ ] `npm run lint && npm run typecheck && npm test` output pasted in the report
- [ ] Commit on the task branch with `type(scope): summary`

### 3.11 Backend backlog (ordered)

Phase 0: repo restructure and Dockerfile → `env.ts` + `brand.ts` → Drizzle schema + first migration → `ledger` → `requests/state` → `config` loader + seed → adapter interfaces + fakes → `/api/health` → pg-boss worker entry → CI pipeline → remove known defects.
Phase 1: `identity` (Firebase exchange, session cookie, work-email OTP) → `insiders` search → `resumes` upload registration → `requests.sendRequest` with escrow → accept/decline/expire → proof + admin verify → timers → email notifications → `rewards` on manual vendor → Playwright flows.
Phase 2: Razorpay → resume pipeline → WhatsApp outbound → interview confirmation → abuse flags → Sentry and logging.
Phase 3: WhatsApp inbound bot → real gift-card adapter → PAN gate → cost auto-adjust → SSE status.

---

## Part 4. Frontend

### 4.1 Scope

Everything under `app/**` pages and layouts, `components/**`, `app/globals.css`, server-action wrappers that only validate and forward, and the PWA manifest.

### 4.2 Route groups and access

| Group | Layout responsibilities | Access |
|---|---|---|
| `app/(public)` | marketing nav, footer, `.seeker-scope` default | anyone |
| `app/(seeker)` | app shell with bottom nav (Home, Insiders, Requests, Profile), `.seeker-scope` | `role in (seeker, both)` |
| `app/(insider)` | app shell (Home, Inbox, Rewards, Profile), `.insider-scope` | `role in (insider, both)` and verified |
| `app/(admin)/admin` | dense desktop tables, no design polish required | `role = admin` |

Layouts read the session server-side and redirect; pages never re-check auth themselves. Users with `role = both` get a role switcher in the header that sets a cookie the layouts respect.

### 4.3 Design system rules

- All colors, radii, shadows, spacing, and type sizes come from the tokens in `app/globals.css` (indigo for Seeker scope, amber for Insider scope, ink neutrals, semantic success/error, WhatsApp green). No arbitrary Tailwind values (`w-[342px]` is forbidden); extend the theme instead.
- Role-scoped accents use `var(--primary)` only. `.seeker-scope` and `.insider-scope` set it.
- Fonts: Plus Jakarta Sans (display) and Inter (body) via `next/font/google`.
- Mobile-first at 390 px; breakpoints `sm` 640, `md` 768, `lg` 1024. Landing max width 1200 px; survey and app forms 680 px.
- Card radius 16 px, button 10 px, pills 999 px. 4 px spacing grid.
- Motion: CSS transitions and the existing `ScrollReveal`/`FadeInSection` patterns. Do not add animation libraries; whether `framer-motion` stays is a Phase 0 decision recorded in `docs/superpowers/specs/`.

### 4.4 Data access rules

- Reads happen in React Server Components calling module functions directly through a server-only data layer (`src/modules/*` via `server-only` imports). No client-side fetching of domain data except polling/SSE for job progress.
- Mutations go through server actions in `app/**/actions.ts` that: parse with the shared Zod schema → `authorize()` → module call → `revalidatePath` → return a typed result `{ ok } | { ok: false, problem }`.
- Client components never import adapters, Drizzle, or vendor SDKs.
- File uploads: client requests a signed PUT URL from a server action, uploads directly to Cloud Storage with the returned headers, then calls a second action to register the object.

### 4.5 Screens (MVP inventory)

Fields, validation, and next actions for every screen are specified in `referly-page-by-page-flow.md` and `referly-insider-user-journey.md` in the vault (apply the locked vocabulary and GetNudgd brand when reading them).

Public: landing `/`, `/survey`, `/login`, `/insider` landing.
Onboarding: `/onboard` role step → Seeker profile step or Insider profile + work-email OTP step.
Seeker: `/dashboard`, `/resume/new` (with job progress), `/resume/[id]`, `/insiders` (search, filters, sort), `/insiders/[id]` (profile + send-request sheet, credit gate), `/requests`, `/requests/[id]` (timeline), `/credits` (packs, Razorpay checkout, history), `/profile`.
Insider: `/dashboard` (pending with 48h countdown, points, re-verify countdown), `/requests` inbox, `/requests/[id]` (accept/decline, proof upload), `/rewards` (wallet, redeem modal with brand and denomination stepper, PAN when required), `/profile` (availability toggle, weekly limit, re-verify).
Admin: `/admin/requests` (verify/reject with reason), `/admin/users` (grant credits), `/admin/redemptions`, `/admin/flags`, `/admin/jobs`, `/admin/audit`.

### 4.6 Component conventions

- `components/ui/*` primitives: Button (primary/ghost, uses `--primary`), Input, Select, Chip, Stepper, Badge, Card, Sheet/Modal, Countdown, Timeline, EmptyState, ErrorState, Skeleton.
- Every list screen implements all four states: loading (skeleton), empty (with a next action), error (problem title + retry), populated.
- Forms use progressive disclosure and inline validation; error copy is human, never a Zod message.
- Money display: credits and points are integers; format with `Intl.NumberFormat('en-IN')`. Rupee amounts are `paise / 100`.
- Countdowns render server time offset, not client clock, to avoid drift.
- Accessibility: semantic HTML, labelled inputs, focus-visible styles, 4.5:1 contrast, keyboard-operable sheets and modals, `prefers-reduced-motion` respected.

### 4.7 Frontend testing

- Vitest + Testing Library for `components/ui/*` and any component with conditional logic.
- Playwright for the three critical flows in 3.8 plus: onboarding both roles, credit gate redirect, admin verify action.
- Visual sanity: run the app (`npm run dev` or the `run` skill), take a screenshot at 390 px and 1280 px, attach to the task report.

### 4.8 Frontend definition of done (per task)

- [ ] All four states implemented for lists; all validation states for forms
- [ ] Tokens only; no arbitrary values; `var(--primary)` for role accents
- [ ] Works at 390 px and 1280 px (screenshots attached)
- [ ] Server-action wrapper is thin: Zod → `authorize()` → module → revalidate
- [ ] Locked vocabulary in all copy; brand from `brand.ts`
- [ ] Tests passing; `npm run lint && npm run typecheck` clean
- [ ] Commit on the task branch

### 4.9 Frontend backlog (ordered)

Phase 0: move survey and landing into `app/(public)`, `/` = landing; `components/ui` primitives; role-scoped app shell layouts; brand config wiring.
Phase 1: `/login` + `/onboard` (both roles, work-email OTP) → `/insiders` + `/insiders/[id]` with send-request sheet → `/requests` + `/requests/[id]` timeline (Seeker and Insider views) → proof upload → Seeker and Insider dashboards → `/rewards` on manual vendor → `/admin` tables.
Phase 2: `/credits` with Razorpay checkout → `/resume/new` with progress → `/resume/[id]` → interview confirmation UI → admin flags.
Phase 3: PWA manifest and install prompt → SSE live status → prefill landing from WhatsApp tokens.

---

## Part 5. Backend and frontend contract

Backend and frontend work can proceed in parallel only when the boundary is fixed first:

1. **Shared Zod schemas** in `src/modules/<module>/schemas.ts` define every input and output type. Frontend imports the types; backend validates with the schema. A task that changes a schema is a backend task and must land before the frontend task that consumes it.
2. **Fakes are the frontend's backend** until the real module exists: frontend tasks run against `src/adapters/*/fake.ts` and a seeded local Postgres.
3. **Problem-details error codes** are enumerated in `src/lib/problems.ts`; the frontend maps each `type` to copy.
4. **Server actions are owned by the frontend track** but may contain only validation, `authorize()`, one module call, and revalidation. Anything more belongs in a module (backend track).

---

## Part 6. Subagent process

This project is executed with the Superpowers workflow. The **controller** is the agent reading this file in the main session. Implementation is delegated to fresh subagents with curated context; the controller never inherits their context and they never inherit the controller's.

### 6.1 Lifecycle of a piece of work

```
idea ──▶ superpowers:brainstorming ──▶ spec in docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md
     ──▶ superpowers:writing-plans ──▶ plan in docs/superpowers/plans/YYYY-MM-DD-<topic>-plan.md
     ──▶ superpowers:using-git-worktrees ──▶ isolated worktree on a feature branch
     ──▶ superpowers:subagent-driven-development ──▶ per task: implementer → spec reviewer → code-quality reviewer
     ──▶ final whole-implementation review ──▶ superpowers:finishing-a-development-branch
```

Skip brainstorming only when a spec already exists for the exact scope. Never skip the plan: subagents receive full task text from the plan, never a pointer to a file.

### 6.2 Roles

| Role | Model tier | Responsibilities | Must not |
|---|---|---|---|
| **Controller** | most capable | Read spec and plan once, extract every task with full text, keep the todo list, dispatch subagents one implementer at a time, answer their questions, run review loops, decide BLOCKED escalations, own the branch | Write code itself (context pollution); dispatch two implementers on the same worktree at once |
| **Backend Implementer** | cheap for 1–2-file mechanical tasks, standard for multi-file | Implement one backend task with TDD, run lint/typecheck/tests, self-review against Part 3 checklist, commit, report status | Touch `app/**` pages or components; add dependencies; hard-code business numbers |
| **Frontend Implementer** | cheap for a single component, standard for a screen | Implement one frontend task with TDD, run the app and screenshot at 390/1280, self-review against Part 4 checklist, commit, report | Touch `src/modules` or `src/adapters`; bypass `authorize()`; use arbitrary Tailwind values |
| **Infra Implementer** | standard | Dockerfile, compose, Caddyfile, CI workflow, `infra/` scripts; verify with a real build | Store secrets in the repo; change app code beyond `env.ts` wiring |
| **Spec Reviewer** | most capable | Compare the diff with the task text only: missing requirements, extra unrequested behaviour, misread requirements | Comment on style; approve "close enough" |
| **Code Quality Reviewer** | most capable | After spec approval: correctness, tests, Part 2/3/4 rules, naming, size, security | Re-litigate the spec |
| **Final Reviewer** | most capable | Whole branch against the spec before finishing | — |

### 6.3 Per-task loop (controller)

1. Take the next task from the plan. Do not start the next one until this one is complete.
2. Choose the implementer role (backend / frontend / infra) and model tier by the complexity signals in 6.2.
3. Dispatch the implementer with the prompt in 6.5, including: the full task text, the relevant Part (2 + 3, or 2 + 4), the module interfaces it touches, the shared schema file contents if any, and the exact commands to verify.
4. If the implementer asks a question, answer it fully before it proceeds.
5. On `DONE` or `DONE_WITH_CONCERNS`, read the concerns, then dispatch the **Spec Reviewer**. Loop implementer → spec reviewer until spec-compliant.
6. Then dispatch the **Code Quality Reviewer** with the commit SHAs. Loop until approved.
7. Mark the task complete. Record any observation worth a follow-up as a note in the plan file, not as scope creep.
8. On `NEEDS_CONTEXT`: supply it and re-dispatch. On `BLOCKED`: provide context, or upgrade the model, or split the task, or escalate to the founder if the plan itself is wrong. Never re-run the same prompt unchanged.

### 6.4 Parallelism rules

- One implementer per worktree at a time. Backend and frontend tracks may run in parallel **only** in separate worktrees on separate branches, and only after the shared schemas for that feature have landed on the integration branch (Part 5).
- Reviewers may run in parallel with nothing else on the same worktree.
- Research and read-only exploration (`Explore` agents) may run in parallel at any time.
- Integration branch per phase (`phase-1`), task branches off it (`phase-1/requests-send-escrow`), merged by the controller after the final review.

### 6.5 Prompt template: implementer

```
You are the {Backend|Frontend|Infra} Implementer for GetNudgd. Work only in the worktree at {path} on branch {branch}.

CONTEXT
- Product: two-sided marketplace (Seekers send Insider Requests with credits; Insiders vouch and earn points). Locked vocabulary: Insider, Seeker, Insider Request, vouch, credits, points.
- Where this task fits: {one paragraph from the plan: what came before, what depends on this}
- Rules that apply (copied from AGENTS.md): {Part 2 + Part 3 or Part 4 relevant subsections}
- Interfaces you must use, verbatim: {paste interface/schema code}

TASK (full text from the plan)
{task text, including files to create/modify and acceptance criteria}

PROCESS
1. If anything is ambiguous, ask before writing code.
2. Follow superpowers:test-driven-development: failing test → minimal code → green → refactor.
3. Verify: run `{exact commands}` and include the output.
4. Self-review against the definition-of-done checklist in AGENTS.md Part {3.10|4.8}.
5. Commit with `type(scope): summary`. Do not push. Do not touch files outside the task's listed scope.

REPORT one status: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED, followed by: files changed, test output, self-review findings, concerns.
```

### 6.6 Prompt template: spec reviewer

```
You are the Spec Reviewer. Compare the diff on branch {branch} (commits {sha..sha}) with this task text only:

{full task text}

Report: (1) requirements not implemented, (2) behaviour implemented that was not requested, (3) requirements implemented differently from the text. Quote the task text for each finding. Do not comment on style or quality. Verdict: SPEC_COMPLIANT or NOT_COMPLIANT with the list.
```

### 6.7 Prompt template: code quality reviewer

```
You are the Code Quality Reviewer for GetNudgd. The spec reviewer has approved commits {sha..sha} on {branch}. Review for correctness, tests, and these rules: {paste AGENTS.md Part 2 and the relevant Part 3/4 subsections}.

Use the superpowers:requesting-code-review format. Classify findings as Critical (must fix), Important (should fix), Minor. Verdict: APPROVED or CHANGES_REQUESTED.
```

### 6.8 Status protocol

| Status | Meaning | Controller action |
|---|---|---|
| `DONE` | Complete, verified, committed | Spec review |
| `DONE_WITH_CONCERNS` | Complete, but flagged doubts | Read concerns; fix correctness/scope issues before review |
| `NEEDS_CONTEXT` | Missing information | Supply it; re-dispatch |
| `BLOCKED` | Cannot proceed | Change something (context, model, task size) or escalate |

### 6.9 Debugging and verification

- Any failing test or unexpected behaviour goes through superpowers:systematic-debugging: reproduce, isolate, hypothesise, fix root cause, add a regression test. No symptom patches.
- Before any report of completion, superpowers:verification-before-completion: run the command, read the output, then claim.

---

## Part 7. Environment variables

Validated in `src/config/env.ts`. All secrets come from GCP Secret Manager at deploy time.

```
NODE_ENV, APP_URL, BRAND_NAME, BRAND_DOMAIN
DATABASE_URL                          # Cloud SQL (private IP or via proxy)
FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN     # public by design (Firebase web config)
GCS_BUCKET_RESUMES, GCS_BUCKET_PROOFS, GCS_BUCKET_PUBLIC
GOTENBERG_URL                         # http://gotenberg:3000 inside compose
OPENAI_API_KEY, LLM_MODEL, PROMPT_VERSION
RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET
WHATSAPP_BSP_API_KEY, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET
BREVO_API_KEY, BREVO_LIST_ID
GIFTCARD_VENDOR=manual|xoxoday|qwikcilver, GIFTCARD_API_KEY
SESSION_COOKIE_SECRET
SENTRY_DSN
ADMIN_IP_ALLOWLIST                    # comma-separated, enforced by Caddy
```

Local dev uses `.env.local` with fake adapters enabled via `ADAPTERS=fake`.

---

## Part 8. Commands

```
npm run dev                 # Next.js dev server
npm run worker:dev          # pg-boss worker with hot reload
npm run lint                # eslint
npm run typecheck           # tsc --noEmit
npm test                    # vitest
npm run test:e2e            # playwright against compose stack
npm run db:generate         # drizzle-kit generate migration
npm run db:migrate          # apply migrations
npm run db:seed             # placeholder config, packs, companies, fake users
docker compose -f infra/compose.dev.yml up      # local Postgres + Gotenberg
docker compose -f infra/compose.prod.yml up -d  # on the VPS (deploy pipeline does this)
```

(Scripts that do not exist yet are created in Phase 0.)

---

## Part 9. Glossary

| Term | Meaning |
|---|---|
| Seeker | Job seeker using GetNudgd to get vouched in |
| Insider | Company-email-verified employee who can vouch |
| Insider Request | What a Seeker sends to an Insider; costs credits |
| vouch | The Insider submitting the Seeker internally |
| credits | Seeker currency, bought in packs via Razorpay |
| points | Insider currency, released per tranche, redeemed for gift cards |
| escrow | Ledger account holding a request's credits until an outcome |
| tranche | One of the two point releases (proof verified; interview confirmed) |
| proof | Screenshot or email text showing internal submission |
| rules_version | The `app_config` version a request was created under |
| prefill token | Short-lived token carrying WhatsApp-collected data into web onboarding |
| BSP | WhatsApp Business Solution Provider (Gupshup) |
