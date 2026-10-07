# GetNudgd — User Flows & Page-by-Page Specification

| | |
|---|---|
| **Product** | GetNudgd (getnudgd.com) |
| **Version** | 1.0, 2026-09-20 |
| **Scope** | Full planned MVP experience — every screen for Seeker, Insider, and Admin, plus the WhatsApp entry funnel. Companion documents: `PRD.md`, `TRD.md`, `AGENTS.md`. |
| **Sources** | `AGENTS.md` (current architecture, routes, design system — most authoritative for structure), `PRD.md`/`TRD.md` (business rules, requirements), and the product vault's `referly-page-by-page-flow.md` / `referly-insider-user-journey.md` / `referly-platform-flow.md` (field-level detail, translated to current GetNudgd branding and locked vocabulary). Where these disagreed, this document favors what's actually specified in `AGENTS.md`/`PRD.md`/`TRD.md` and says so. |

## How to read this document

Every page section has the same shape: **Purpose**, **Access**, **What's on the page**, **Actions** (every button/click and what happens), **States** (the four states every list/form screen must implement per `AGENTS.md` §4.6: loading, empty, error, populated), and a **Build status** line.

**Build status legend:**
- 🟢 **Backend built** — the domain module and adapter exist and are tested (`src/modules/*`), reachable via a standalone script but not yet wired to any route.
- 🟡 **Backend partial** — some of the module exists; specifics noted inline.
- ⚪ **Not started** — no backend module, no frontend route exists yet.

As of this writing, **no application route beyond `/`, `/survey`, and `/api/health` actually exists in `app/**`.** Everything else in this document describes the target experience the backend increasingly supports — every Seeker/Insider/Admin screen below is currently ⚪ on the frontend. Backend status is called out per section because several backend modules (identity, insiders, resumes, requests/escrow, proof submission, admin verification) are already built and tested, ahead of any UI.

---

## 1. Site map

| Route | Page | Who | Auth | Build status |
|---|---|---|---|---|
| `/` | Landing page | Everyone | No | Built (pre-dates this rebuild; may need a copy/vocab pass) |
| `/survey` | Pre-launch survey | Everyone | No | Built |
| `/login` | OTP / Google sign-in | Everyone | No | ⚪ frontend; identity backend 🟢 |
| `/for-insiders` | Insider-focused landing page | Everyone | No | ⚪ |
| `/onboard` | Role selection + profile setup | New users | Yes (just signed in) | ⚪ frontend; identity backend 🟢 |
| `/seeker/dashboard` | Seeker home | Seeker, both | Yes | ⚪ |
| `/seeker/resume/new` | Upload + tailor a resume | Seeker, both | Yes | 🟡 backend (upload registration only — parsing/tailoring pipeline not built) |
| `/seeker/resume/[id]` | View/download a tailored resume | Seeker, both | Yes | 🟡 (same) |
| `/seeker/insiders` | Browse & search Insiders | Seeker, both | Yes | 🟢 backend (`insiders` module) |
| `/seeker/insiders/[id]` | Insider profile + send request | Seeker, both | Yes | 🟢 backend |
| `/seeker/requests` | Sent requests list | Seeker, both | Yes | 🟢 backend (`requests.listByState`, needs a by-seeker-profile query) |
| `/seeker/requests/[id]` | Request detail + timeline | Seeker, both | Yes | 🟢 backend |
| `/seeker/credits` | Buy credits, balance, history | Seeker, both | Yes | ⚪ (Razorpay integration not started) |
| `/seeker/profile` | Edit profile | Seeker, both | Yes | 🟡 (identity module has the pieces; no dedicated "edit profile" function yet) |
| `/insider/dashboard` | Insider home | Insider, both, verified | Yes | ⚪ |
| `/insider/requests` | Inbox | Insider, both, verified | Yes | 🟢 backend |
| `/insider/requests/[id]` | Request detail + accept/decline/proof | Insider, both, verified | Yes | 🟢 backend |
| `/insider/rewards` | Points wallet + redemption | Insider, both, verified | Yes | ⚪ (`rewards` module not built — next after this document, per `AGENTS.md` §3.11) |
| `/insider/profile` | Edit profile, re-verify | Insider, both, verified | Yes | 🟡 |
| `/admin/requests` | Verification queue | Admin | Yes | 🟢 backend (`admin.listPendingProofs`, `admin.reviewProof`) |
| `/admin/users` | User list + credit grants | Admin | Yes | 🟡 (identity exists; grant-credits action not built) |
| `/admin/redemptions` | Gift card redemption log | Admin | Yes | ⚪ |
| `/admin/flags` | Abuse flag review | Admin | Yes | ⚪ (Phase 2 per `AGENTS.md` §3.11) |
| `/admin/jobs` | pg-boss job health dashboard | Admin | Yes | ⚪ |
| `/admin/audit` | Admin action audit log | Admin | Yes | 🟢 backend (`admin_audit_log` table + `listAuditLogByTarget`) |
| `wa.me/...` | WhatsApp bot | Everyone | No | ⚪ (Phase 3 per `AGENTS.md` §3.11) |

Every Seeker route lives under `/seeker/*` and every Insider route under `/insider/*` as literal path segments — not Next.js route groups. `AGENTS.md` §1.3/§4.2 documents why: route groups don't affect the URL, and an earlier attempt at `(seeker)`/`(insider)` groups collided on `/dashboard`, `/requests`, `/profile`. `TRD.md` §14 still describes route groups; this document and `AGENTS.md` are current.

Users with `role = both` (both a Seeker and a verified Insider) get a role switcher in the header that sets a cookie the layouts respect, per `AGENTS.md` §4.2.

---

## 2. WhatsApp entry funnel ⚪ (Phase 3)

Not built yet, but part of the full planned experience. Summary of the intended flow (full script belongs in a future `whatsapp-flow.md` once built):

1. A Seeker messages the GetNudgd WhatsApp number, or forwards a job posting link/text.
2. Bot: *"Got it — tailoring your resume for this role. Takes about a minute."*
3. Bot delivers a free, ATS-tailored resume (no credits needed — this is the acquisition hook, not a paid feature).
4. If verified Insiders exist at the target company, bot lists up to three and sends a deep link into the web app with company, role, and resume pre-filled (a "prefill token," per `AGENTS.md`'s `prefill_tokens` table).
5. Seeker taps the link, lands on `/onboard` with everything pre-filled but still editable — WhatsApp never collects payment or proof of submission; both always happen on web.

**Build status:** the `whatsapp` module, `whatsapp_sessions` table, and `prefill_tokens` table are all unbuilt. This is explicitly the last item in `AGENTS.md`'s Phase 3 backend backlog.

---

## 3. Public pages

### `/` — Landing page
**Purpose:** Convert a cold visitor into a signup, for either role.
**Access:** Everyone, no auth.
**What's on the page:** Hero with the core value prop ("Get vouched in" for Seekers), how-it-works section, social proof, a secondary CTA toward the Insider side (linking to `/for-insiders`), footer.
**Actions:** Primary CTA → `/login` (or directly to `/onboard` if already signed in). Secondary "Become an Insider" CTA → `/for-insiders`.
**States:** Single populated state; no data fetching.
**Build status:** Built, pre-dates the current rebuild — worth a pass to confirm it uses `src/config/brand.ts` and the locked vocabulary rather than any leftover "Referly" copy.

### `/survey` — Pre-launch survey
**Purpose:** Pre-launch interest capture (predates the full product build).
**Access:** Everyone, no auth.
**Build status:** Built.

### `/login` ⚪
**Purpose:** Get a verified identity before anything else.
**Access:** Everyone, no auth.
**What's on the page:** Email or phone input, a "Continue with Google" button, and (after email/phone submit) a 6-digit OTP field.
**Actions:**
- Submit email/phone → Firebase sends an OTP → OTP field appears.
- Submit correct OTP → `signInWithFirebaseToken` (already built, `src/modules/identity`) exchanges the Firebase ID token for a session → new user redirects to `/onboard`; returning user redirects to `/{role}/dashboard`.
- "Continue with Google" → same exchange via Google's ID token, skips the OTP step.
**States:** Form validation errors (invalid email/phone format, wrong OTP) shown inline, human copy, never a raw Firebase error string.
**Build status:** Backend (`signInWithFirebaseToken`) is built and tested against a fake auth adapter; the real Firebase adapter itself is still deferred (a founder decision recorded during Phase 1: fake now, real Firebase later). No route or UI exists yet.

### `/for-insiders` ⚪
**Purpose:** A landing page addressed specifically to potential Insiders — separate from `/` so the authenticated Insider app can live at the unambiguous `/insider/*` prefix.
**Access:** Everyone, no auth.
**What's on the page:** Value prop ("Help people get vouched in. Earn gift cards."), the company-email-verification rule stated up front (not as a surprise after signup), a short "how it works" for the Insider side.
**Actions:** "Become an Insider" CTA → `/onboard`.
**Build status:** ⚪.

---

## 4. Onboarding — `/onboard` ⚪ (frontend); identity backend 🟢

### Step 1 — Role selection
**What's on the page:** "I am a..." — Seeker or Insider (an account can later hold both; see `/seeker/profile`'s "Add Insider role").
**Actions:** Choosing a role branches into the corresponding step below.

### Step 2a — Seeker profile
**Fields:** Full name (required). *(PRD's vault source also lists city, target companies, and a domain/field dropdown — these aren't in the current `seeker_profiles` schema, which currently has only `full_name`; see "Known gaps" §9 below.)*
**On submit:** `createSeekerProfile` (built) creates the row → redirect to `/seeker/dashboard`, with a nudge toward `/seeker/resume/new`.

### Step 2b — Insider profile + work-email verification
**Fields:** Full name, work email (must resolve to a domain already registered in `company_domains` — an unrecognized domain shows an explanation, not a silent rejection).
**On submit:** `startWorkEmailOtp` (built) resolves the company from the domain, creates (or reuses — idempotently, per a fix landed this session) the Insider profile, and emails a 6-digit code to the work address.
**Next screen — OTP entry:** single 6-digit field.
**On correct OTP:** `verifyWorkEmailOtp` (built) marks the profile verified and **promotes the user's role** from `seeker` to `both` (a real bug caught and fixed this session — verification used to mark the profile verified without ever changing the role, which would have permanently locked verified Insiders out of the `role in (insider, both)` gate). Redirects to `/insider/dashboard`.
**Then, still part of onboarding (not yet built as its own step):** role title, seniority, up to three roles they can vouch for, weekly request limit (1–5, default 3), short bio, availability toggle — per `PRD.md` R4. These fields don't exist on `insider_profiles` yet beyond `weekly_limit` and `available`; see §9.

**Build status:** the OTP round-trip, domain resolution, idempotent profile creation, and role promotion are all built and tested. The richer profile fields (seniority, vouch roles, bio) are not yet in the schema.

---

## 5. Seeker journey

### `/seeker/dashboard` ⚪
**Purpose:** Home base — status at a glance, nudge toward the next action.
**What's on the page (no input fields, a summary view):** active Insider Requests (count + latest status), credit balance (with a "Buy more" CTA if low), tailored resumes list, suggested Insiders at target companies if any newly verified.
**Actions:** "Get a tailored resume" → `/seeker/resume/new`. "Browse Insiders" → `/seeker/insiders`.
**States:** empty state for a brand-new account ("no requests yet — start by browsing Insiders").

### `/seeker/resume/new` 🟡
**Purpose:** The free hook — AI resume tailoring.
**Fields:** Job post link (or paste JD text as a fallback), resume file upload (PDF/DOCX, reused after the first time).
**On submit:** registers the upload (`resumes.registerUpload`, built) → *(the parse/tailor pipeline itself — GPT-4o extraction, `docx` template fill, Gotenberg PDF render — is not built; this is explicitly Phase 2 per `AGENTS.md` §3.11)* → redirects to `/seeker/resume/[id]` to show progress.
**States:** job-in-progress state (polling per `TRD.md` T-14.8, every 3 seconds until terminal), failure state with retry and an explicit "nothing was charged" per `PRD.md` R6.
**Build status:** upload registration only.

### `/seeker/resume/[id]` 🟡
**Purpose:** View and download the tailored output.
**What's on the page:** DOCX/PDF download buttons once ready, a summary of what changed, and a CTA — "Found the right Insider for this? Send a request →" linking to `/seeker/insiders?company=X`, pre-filtered by the company extracted from the job description.
**Build status:** depends on the unbuilt tailoring pipeline.

### `/seeker/insiders` 🟢 backend
**Purpose:** Search and shortlist.
**Fields:** search by company, filter by role/seniority (once those profile fields exist), sort by credit cost.
**What's on the page:** a card grid — each card shows the verified badge, company, tier, and the credit cost computed live from `app_config`'s `requestCostByTier` (never hardcoded, per `AGENTS.md` §0.5).
**Actions:** click a card → `/seeker/insiders/[id]`.
**States:** empty state for a company with no verified Insiders yet.
**Build status:** `insiders.listInsiders` (verified + available only, company-filterable, config-driven cost) is built and tested.

### `/seeker/insiders/[id]` 🟢 backend
**Purpose:** Decide and send the request.
**What's on the page:** profile display (no fields on load) — bio, credit cost. "Send Insider Request" opens a form.
**Fields (in the send form):** attach a tailored resume (dropdown of existing `/seeker/resume/[id]` results, or a link to tailor a new one), a personal note (nudged, not required), credit cost (read-only), a "Confirm & Send" button.
**On submit:** `requests.sendRequest` (built) — checks the Insider is verified and available, computes cost from the current config, debits the Seeker's credit balance into a per-request escrow ledger account, creates the request row in `SENT` state, and starts the 48-hour response clock (the clock itself — a pg-boss timer that calls `expire()` — is not built yet; `expire()` exists and is idempotent, ready for a scheduler to call it).
**Validation:** insufficient balance → redirected to `/seeker/credits` with a "top up to continue" banner, per `PRD.md` R8.
**On success:** redirects to `/seeker/requests/[id]`.
**Build status:** `sendRequest`'s full escrow logic, availability gating, and idempotent retry-safety are built and tested end-to-end against a real local Postgres (verified this session, including the real `SELECT ... FOR UPDATE` locking and the real zero-sum ledger trigger).

### `/seeker/requests` 🟢 backend
**Purpose:** Track everything in flight.
**What's on the page:** a filterable list (by state). `Database.requests.listByState` exists; a by-seeker-profile-id filter doesn't yet (the FK index for it was added this session in anticipation).
**Actions:** click a row → `/seeker/requests/[id]`.
**States:** all four (loading/empty/error/populated) per `AGENTS.md` §4.6 — none built into a screen yet.

### `/seeker/requests/[id]` 🟢 backend
**Purpose:** Full timeline for one request.
**What's on the page:** a timeline display driven by the append-only `request_events` table — every transition (`send`, `accept`/`decline`, `proof`, `verify`/`reject`, eventually `interview`/`windowExpiry`) is a row with a `fromState`/`toState`/timestamp, ready to render directly. Shows the Insider's note if any, and — if refunded — how much came back and why, referencing the `rules_version` the request was created under (so a later config change never silently reprices an in-flight request; this exact bug was caught and fixed this session).
**Build status:** `accept`, `decline` (with config-driven refund), `expire` (idempotent, config-driven refund), `submitProof`, and `admin.reviewProof` (verify/reject) are all built, tested, and — for the ledger/escrow paths — verified against a real Postgres this session. Interview confirmation (the next two transitions in the state machine) is not built; see §9.

### `/seeker/credits` ⚪
**Purpose:** Buy credits, see history.
**Fields:** a pack selector (cards, from `app_config`'s `credit_packs` — never hardcoded), Razorpay checkout (card/UPI/netbanking — Razorpay owns those fields, GetNudgd never sees card data).
**What's on the page below the buy flow:** transaction history (purchase/spend/refund, running balance) — this is a direct, ready-made read off the `ledger_entries` table already built.
**On successful payment:** Razorpay webhook (HMAC-verified) posts a `platform → seeker` ledger transaction, idempotent by `razorpay:{payment_id}` so a duplicate webhook notification never double-credits (`PRD.md` R7, `TRD.md` T-5.1).
**Build status:** the ledger machinery that would record a purchase already exists and is tested; the Razorpay integration itself (Phase 2 per `AGENTS.md` §3.11) is not built.

### `/seeker/profile` 🟡
**Fields:** name and other editable identity fields; a "target companies" list (not yet in the schema, see §9); notification channel toggles (Email/WhatsApp — notifications module not built yet); an "Add Insider role" button that re-runs the Insider onboarding step and sets `role = both`.
**Build status:** the underlying `identity` module has the pieces (`getUserById`, role promotion), but no dedicated "edit Seeker profile" function exists yet.

---

## 6. Insider journey

### `/insider/dashboard` ⚪
**Purpose:** Home base for an Insider.
**What's on the page (summary, no fields):** pending requests needing action (with a 48-hour countdown, computed from a server-supplied timestamp per `TRD.md` T-14.6, never the client clock alone), points balance, verification status and the 90-day re-verification countdown.
**Build status:** the underlying reads (`admin.listPendingProofs`-style queries adapted for "my inbox", `insiders` verification status) exist in pieces; no dashboard aggregation function yet.

### `/insider/requests` 🟢 backend
**Purpose:** Triage incoming requests.
**What's on the page:** a filterable list (New/Accepted/Submitted/Closed), driven by `requests.listByState` (built) — needs a by-insider-profile-id filter, same gap as the Seeker side, same FK index already added in anticipation.
**Actions:** click a row → `/insider/requests/[id]`.

### `/insider/requests/[id]` 🟢 backend
**Purpose:** Act on one request.
**What's on the page:** candidate context, the tailored resume (once the resume pipeline exists), the Seeker's note.
**Actions, if the request is `SENT`:**
- **Accept** → `requests.accept` (built, tested) → state becomes `ACCEPTED`, no money moves.
- **Decline** → `requests.decline` (built, tested) → state becomes `DECLINED`, escrow refunds to the Seeker per the config's `refundPercentOnDecline` (default seeded at 100%, a placeholder the founder will set).

**If `ACCEPTED` — proof submission step:**
| Field | Type | Required |
|---|---|---|
| Proof type | screenshot upload or pasted confirmation text | One of the two |
| Submit | button | — |

`submitProof` (built, tested) — moves `ACCEPTED → PROOF_PENDING`, records the proof, and is idempotent per submission attempt (a caller-supplied key, not a fixed one — because an Insider can be rejected and resubmit more than once across a request's lifetime; this exact design point, and a real bug in an earlier draft of the "get the current proof" read path, were caught and fixed this session).

**After that, out of the Insider's hands** — the request sits in `PROOF_PENDING` until an admin reviews it (§7).

**If rejected by admin:** state returns to `ACCEPTED` with a reason shown, and the Insider can submit proof again.

**Build status:** accept/decline/submitProof are fully built and tested, including the config-driven refund math and the idempotent-resubmission design. No UI exists.

### `/insider/rewards` ⚪
**Purpose:** Insider's points wallet and redemption.
**What's on the page:** points balance, lifetime earned, redemption history.
**Fields (redeem modal):** gift card brand, denomination (stepper, capped at balance), PAN (only required once cumulative lifetime rewards cross the configured threshold, per `PRD.md` R13), "Confirm redemption."
**Build status:** none of the `rewards` module exists yet — points issuance per tranche, redemption requests, the PAN gate. This is explicitly the next backend item after proof/admin-verify per `AGENTS.md` §3.11's ordering ("proof + admin verify → timers → email notifications → rewards on manual vendor"). The gift-card vendor itself is stubbed at MVP (`ManualFulfilmentVendor`).

### `/insider/profile` 🟡
**Fields:** name, role title, seniority, bio, vouch roles, weekly request limit, availability toggle (hides the profile from `/seeker/insiders` search when off — `insiders.setAvailability` is built), PAN, "Re-verify company email" (re-runs the OTP flow, resets the 90-day clock).
**Build status:** `setAvailability` exists; most of the richer profile-editing surface doesn't yet.

---

## 7. Admin console (`/admin`)

Dense, keyboard-friendly tables — no design polish required at MVP, per `AGENTS.md` §4.2/`PRD.md` §4.3. Founder-only (`role = admin`), and **every admin mutation writes an append-only `admin_audit_log` row in the same database transaction as the change it makes** — this is enforced structurally in the code (the review found this needs to be enforced per-call-site as more admin actions are added; see §9), not just as a convention.

### `/admin/requests` 🟢 backend
**Purpose:** The proof verification queue.
**What's on the page:** every request currently in `PROOF_PENDING`, with its most recently submitted proof (correctly the *latest* one across a reject/resubmit cycle — a real bug in an earlier draft returned the oldest proof, caught and fixed this session before any UI could have shipped the bug).
**Actions per row:**
- **Verify** → `admin.reviewProof(decision: "verify")` → state becomes `SUBMITTED`, releases tranche 1 *(tranche release itself is a `rewards`-module concern, not yet built — the state transition and audit log are built now, ahead of it)*.
- **Reject**, with a required reason → `admin.reviewProof(decision: "reject")` → state returns to `ACCEPTED`, Insider notified with the reason, can resubmit.

**Build status:** `admin.listPendingProofs` and `admin.reviewProof` are built and tested, including the mandatory audit-log write on every decision.

### `/admin/users` 🟡
**Purpose:** User list, searchable, with a manual credit-grant action (for early testers before Razorpay is wired up, per the vault's original spec — still a reasonable MVP need).
**Build status:** the `identity` module can look up users; `grantCredits` (posting a `platform → seeker` ledger entry with a reason and an audit-log row, per `TRD.md` T-5.8) is not built yet.

### `/admin/redemptions` ⚪
**Purpose:** Every gift card issued, for reconciliation against the rewards vendor's invoice.
**Build status:** depends on the unbuilt `rewards` module.

### `/admin/flags` ⚪
**Purpose:** Abuse flag review.
**Build status:** Phase 2 per `AGENTS.md` §3.11.

### `/admin/jobs` ⚪
**Purpose:** pg-boss job/queue health dashboard (queue depth, failed jobs).
**Build status:** the pg-boss worker entry point and queue client exist (`src/jobs`); no admin-facing dashboard.

### `/admin/audit` 🟢 backend
**Purpose:** Every admin action, in order, with who/what/when/why.
**What's on the page:** a direct read of `admin_audit_log` — append-only, DB-trigger-enforced (mirroring the same protection `ledger_entries` and `request_events` already have).
**Build status:** the table, trigger, and `listAuditLogByTarget` read are built; no dashboard UI.

---

## 8. Cross-cutting concerns

### 8.1 Request state machine — as actually implemented

```
SENT ─accept──▶ ACCEPTED ─proof──▶ PROOF_PENDING ─verify──▶ SUBMITTED ─interview──▶ INTERVIEW ──▶ COMPLETE
 │                 ▲                    │                        │
 ├─decline──▶ DECLINED                  └─reject──▶ ACCEPTED     └─window expiry──▶ NO_INTERVIEW ──▶ CLOSED
 ├─48h expiry─▶ EXPIRED
 └─seeker cancel (only while SENT)─▶ CANCELLED
```

11 states, defined once in `src/modules/requests/state.ts` and enforced everywhere else — any event not valid for the current state is rejected (`InvalidTransitionError`), matching `TRD.md` T-6.1.

**Built and tested:** `send`, `accept`, `decline`, `expire`, `proof`, `verify`, `reject` — the whole left/middle portion of the diagram, including every ledger movement.
**Not yet built:** `interview`, `complete`, `windowExpiry`, `close` — the right-hand portion (interview confirmation onward). `cancel` (Seeker-initiated, while still `SENT`) is also not yet built.

### 8.2 Known documentation gap: interview confirmation and disputes

`TRD.md` §6.1 describes a richer flow than what's built or than the diagram above shows: `SUBMITTED → INTERVIEW_REPORTED → (dispute window) → INTERVIEW` or `→ DISPUTED → admin resolves`, plus a `declineAfterReview` event and per-scenario refund percentages (`decline_before_review` vs `decline_after_review`). None of `INTERVIEW_REPORTED`, `DISPUTED`, or `declineAfterReview` exist in the actual `state.ts` — the built state machine only has a single `windowExpiry` timer transition with no dispute step. This is a real, unreconciled gap between `TRD.md`'s "approved baseline" and the current implementation, not a decision this document is making — it's flagged here rather than silently resolved one way or the other, so whoever plans the next "interview confirmation" backend slice (the next item after `rewards` per `AGENTS.md` §3.11) makes the call explicitly: build the simpler single-timer version the current state machine already has room for, or extend the state machine to match `TRD.md`'s dispute flow first.

### 8.3 Refund and reward percentages — all configuration, never hard-coded

Per `AGENTS.md` §0.5, every number below lives in `app_config` and is loaded through the `config` module; nothing here is a fixed constant in code. Current seeded **placeholder** values (the founder will supply real ones):

| Config key | Placeholder value | Applies to |
|---|---|---|
| `requestCostByTier` | tier1: 3, tier2: 2, tier3: 1 | Credits debited when a Seeker sends a request |
| `refundPercentOnDecline` | 100% | Escrow refund when an Insider declines |
| `refundPercentOnExpiry` | 100% | Escrow refund when a request expires unanswered |
| `responseWindowHours` | 48 | How long an Insider has to accept/decline |
| `interviewWindowDays` | 14 | (reserved for the not-yet-built interview-confirmation window) |
| `reverificationDays` | 90 | How often an Insider must re-verify their work email |
| `tranche1Percent` / `tranche2Percent` | 50 / 50 | Point-release split (reserved — `rewards` module not built) |
| `minRedemptionPoints` | 500 | Minimum points balance to redeem a gift card |
| `panThresholdPoints` | 5000 | Cumulative points that trigger a PAN capture requirement |
| `freeCreditGrant` | 3 | Free credits granted to a new Seeker |

The vault's older planning docs (`referly-platform-flow.md`) describe a more elaborate dynamic-pricing model (credit cost scaling with an Insider's seniority, track record, and demand, plus an explicit 20% platform-fee cut) — that is a **Phase 1 "should have" fast-follow** per `PRD.md` P1.3, not the MVP. The MVP uses flat, tier-only pricing exactly as the table above shows.

### 8.4 Money flow (as built)

```
Seeker buys credits (not yet wired — Razorpay pending)
        │
Seeker sends a request: seeker → escrow (full cost)
        │
   ┌────┴────┐
 accept    decline/expire
   │           │
   │      escrow → seeker (refund%) + escrow → platform (forfeit%)
   │
 proof submitted, admin verifies
   │
 (tranche release to Insider — not yet built; rewards module pending)
```

Every credit-moving operation is idempotent (derived from the triggering event, e.g. `send:{key}`, `request:{id}:accept`) and runs inside a database transaction that locks the affected ledger accounts before reading balances — verified against a real local Postgres this session, including the DB-level append-only and zero-sum-enforcement triggers actually rejecting a hand-crafted unbalanced insert and a hand-crafted `UPDATE`/`DELETE` on the append-only tables.

---

## 9. Known gaps (carried forward from the vault docs and this session's build)

1. **Seeker profile fields.** The vault's page-by-page spec lists city, a domain/field dropdown, and a target-companies list; the current `seeker_profiles` schema has only `full_name`. Needs a decision (and likely a `target_companies` join table, which the vault docs already recommend over a jsonb column, to support a future "notify me when an Insider verifies at my target company" nudge — `PRD.md` P1.1).
2. **Insider profile fields.** Similarly, `insider_profiles` currently has only company/work-email/verification/`available`/`weekly_limit` — role title, seniority, vouch-role selection, and bio from `PRD.md` R4 aren't in the schema yet.
3. **Interview confirmation and disputes** — see §8.2. Needs an explicit design decision before the next backend plan builds it.
4. **The `rewards` module** doesn't exist yet — points issuance, redemption, and the PAN gate are all ahead. This blocks `/insider/rewards` and `/admin/redemptions` entirely.
5. **`admin_audit_log`'s mandatory-write guarantee is per-call-site today**, not structurally enforced by the type system (the optional `adminAudit` field on `applyTransition` means a future admin mutation *could* forget to pass it and still compile). Worth revisiting — e.g. a dedicated `applyAdminTransition` with a required audit field — before many more admin actions are added.
6. **Weekly Insider request-capacity limits** (`insider_profiles.weekly_limit`) are tracked in the schema but not enforced anywhere yet — enforcing it meaningfully needs the `insider.weeklyReset` cron job (Phase 1 "timers" backlog item) first.
7. **`authorize.ts` doesn't yet know about `insiderRequest` as a resource type**, and `submitProof`/`reviewProof` don't yet take an actor identity — both will need to change the moment a server action wires these modules up, since request ownership involves two parties (Seeker and Insider) plus admin, not the single-owner pattern `authorize()` currently handles.
