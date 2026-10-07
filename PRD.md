# GetNudgd — Product Requirements Document (PRD)

| | |
|---|---|
| **Product** | GetNudgd (getnudgd.com) |
| **Version** | 1.0, 2026-09-19 |
| **Owner** | Anmol (founder) |
| **Status** | Approved baseline for MVP build. Companion documents: `TRD.md` (technical requirements), `AGENTS.md` (engineering guide), architecture plan dated 2026-09-19 in the product vault. |
| **Scope** | MVP: web platform for Seekers, Insiders and Admin, plus the WhatsApp entry funnel. |

---

## 1. Problem statement

Most white-collar hiring in India moves through employee referrals, but access to a referral depends on who you already know. Job seekers without a network submit cold applications that rarely get a response, and employees who would happily vouch for good candidates have no structured, low-effort way to receive, evaluate and act on requests from people outside their circle.

GetNudgd gives every job seeker a verified path to an employee at their target company, and gives employees a one-tap way to review candidates, vouch for the ones they believe in, and be rewarded for verified participation.

---

## 2. Goals

| # | Goal | Measure |
|---|---|---|
| G1 | A Seeker can go from first contact to a sent Insider Request in one session | Median time from signup to first request under 15 minutes |
| G2 | Insiders respond quickly | ≥ 70% of requests answered (accept or decline) within 48 hours |
| G3 | The free resume hook converts | ≥ 40% of Seekers who receive a tailored resume create a web account |
| G4 | Every request reaches a clear terminal state with the promised outcome | 100% of requests closed by the system with the correct credit or points movement; zero manual ledger corrections |
| G5 | The founder can run the marketplace alone | Every operational action available in `/admin`; proof verification median under 24 hours |

---

## 3. Non-goals (MVP)

| Non-goal | Why |
|---|---|
| Native mobile apps (iOS/Android) | Web-first is the locked decision; revisit after web retention data exists |
| In-app chat between Seeker and Insider | Adds moderation load; the request note plus status timeline covers the MVP need |
| Job board or job listings | GetNudgd is referral-first; jobs arrive with the Seeker (link or JD text) |
| Company-side (employer) dashboards or bulk sourcing | Separate product line; not needed to validate the two-sided loop |
| Automated proof verification | Manual admin verification is acceptable at MVP volumes; automation is a Phase 4 item |
| Subscriptions, boosts, priority requests | Credit packs alone are enough to validate willingness to pay |
| Multi-language UI | English with Hinglish copy accents is sufficient for the launch audience |

---

## 4. Users and personas

### 4.1 Seeker
Indian job seeker, 18–28, tier 1 or tier 2 city, actively applying, mobile-first, lives on WhatsApp. Wants a real person on the inside, a clear price, and to know what is happening with each request. Frustrated by silence after applying and by opaque "sifarish".

### 4.2 Insider
Employee at an Indian startup or MNC, 24–35, has a company email and access to an internal referral portal. Willing to help good candidates if it costs minutes, not hours. Wants verified, relevant candidates, a hard limit on volume, and a reward that does not require paperwork.

### 4.3 Admin (founder)
Operates everything solo at MVP: verifies proofs, grants credits, reviews abuse flags, fulfils redemptions, answers disputes. Needs dense, fast, keyboard-friendly screens and an audit trail.

### 4.4 System actors
WhatsApp bot (entry funnel and notifications), background timers (48-hour, interview window, 90-day re-verification), payment provider, LLM tailoring pipeline.

---

## 5. Vocabulary (locked)

| Term | Meaning |
|---|---|
| Seeker | Job seeker using GetNudgd |
| Insider | Company-email-verified employee who can vouch |
| Insider Request | What a Seeker sends to an Insider; costs credits |
| vouch | Insider submitting the Seeker through their company's referral process |
| credits | Seeker currency, purchased in packs |
| points | Insider currency, released in tranches, redeemable for gift cards |
| proof | Screenshot or email text showing the internal submission |
| tranche | One of two point releases: proof verified, interview confirmed |
| "Get vouched in" | Primary Seeker CTA |

Never use: referrer, referral giver, referral request, refer (verb), payout.

---

## 6. End-to-end flows

### 6.1 Seeker: WhatsApp entry to request

1. Seeker messages the GetNudgd WhatsApp number or forwards a job post.
2. Bot asks for target company and role (or extracts them from the forwarded post) and for a resume file.
3. Pipeline tailors the resume; bot returns DOCX and PDF within about 45 seconds.
4. If verified Insiders exist at that company, bot lists up to three and sends a deep link to the web app that pre-fills company, role and resume.
5. Seeker signs up on web, completes the short profile, buys a credit pack (or uses a free grant if configured), attaches the tailored resume, writes a note, confirms the credit cost, sends the request.
6. Seeker tracks the request on a timeline and receives WhatsApp (or email) updates at every state change.

### 6.2 Seeker: web-only

Steps 5–6 above, with resume upload and tailoring done on `/resume/new`.

### 6.3 Insider: verification to reward

1. Insider signs up, enters company email, receives OTP in the work inbox, verifies.
2. Fills profile: role, seniority, up to three roles they can vouch for, weekly request cap, bio, name or anonymous display.
3. Profile goes live in search. WhatsApp confirms.
4. New request arrives on WhatsApp and in the web inbox with a 48-hour countdown.
5. Insider accepts or declines. On accept, submits internally, uploads proof.
6. Admin verifies proof; tranche 1 points released. Interview confirmed within the window; tranche 2 released.
7. Insider redeems points above the minimum for a gift card. Every 90 days the Insider re-verifies the company email.

### 6.4 Request outcomes

| Outcome | Trigger | Seeker | Insider |
|---|---|---|---|
| Expired | No response within the response window | Refund per config (default: full) | Response-rate stat lowered |
| Declined | Insider declines | Refund per config | None |
| Cancelled | Seeker cancels while still unanswered | Full refund | None |
| Submitted, no interview | Window elapses after verified proof | Partial refund per config | Keeps tranche 1 |
| Interview confirmed | Either party reports, no dispute | No refund | Tranche 2 released |

All percentages, windows, and thresholds are configuration values supplied by the founder; the product must never hard-code them.

---

## 7. User stories

### 7.1 Seeker

- S1. As a Seeker, I want to send a job post and my resume on WhatsApp and get a tailored, ATS-friendly resume back, so that I get value before creating an account.
- S2. As a Seeker, I want to see which verified Insiders exist at my target company, so that I know a request is possible before I pay.
- S3. As a Seeker, I want to sign up with phone OTP, email OTP, or Google, so that onboarding takes under two minutes.
- S4. As a Seeker arriving from WhatsApp, I want my company, role and resume pre-filled on the web, so that I do not repeat myself.
- S5. As a Seeker, I want to search Insiders by company, role and seniority and see credit cost, response rate and vouches done, so that I can choose well.
- S6. As a Seeker, I want to buy a credit pack with UPI, card or netbanking and see my balance and history, so that I understand what I have spent.
- S7. As a Seeker, I want to attach a tailored resume and a short note to a request and confirm the exact credit cost before sending, so that there are no surprises.
- S8. As a Seeker, I want to be blocked from sending when my balance is too low and taken straight to top-up, so that I do not lose my draft.
- S9. As a Seeker, I want a timeline for each request showing every state change and any refund with its reason, so that I always know where I stand.
- S10. As a Seeker, I want to cancel a request that has not been answered yet and get my credits back, so that I can redirect them.
- S11. As a Seeker, I want to be asked whether I got an interview and to confirm it in one tap, so that the request closes correctly.
- S12. As a Seeker, I want WhatsApp updates for every change, with email as a fallback, so that I do not need to keep checking the site.
- S13. As a Seeker, I want to generate more tailored resumes for other jobs from the web, so that I can reuse the tool.
- S14. As a Seeker, I want to delete my account and files, so that my data is not kept when I am done.

### 7.2 Insider

- I1. As an Insider, I want to verify with my company email only, so that Seekers can trust that I actually work there.
- I2. As an Insider, I want to set which roles I can vouch for and a weekly cap on requests, so that I am not overwhelmed.
- I3. As an Insider, I want to choose whether my full name or initials are shown, so that I control my exposure.
- I4. As an Insider, I want to receive each new request on WhatsApp with a link to review it, so that I can act from my phone.
- I5. As an Insider, I want to see the candidate's tailored resume, target role and note, with a visible countdown, so that I can decide quickly.
- I6. As an Insider, I want to accept or decline in one tap, with an optional reason on decline, so that responding is effortless.
- I7. As an Insider, I want to upload proof of internal submission by screenshot or by pasting the confirmation email, so that my first tranche is released.
- I8. As an Insider, I want to see points balance, pending points, and per-request history, so that I know what I have earned.
- I9. As an Insider, I want to redeem points for a gift card brand and denomination of my choice once I pass the minimum, so that rewards are tangible.
- I10. As an Insider, I want to pause my availability, so that I stop receiving requests without deleting my profile.
- I11. As an Insider, I want a reminder before my 90-day re-verification and a one-tap way to do it, so that my profile does not go dark unexpectedly.
- I12. As an Insider, I want to be told when a candidate I vouched for reports an interview, so that I can confirm and receive tranche 2.

### 7.3 Admin

- A1. As Admin, I want a queue of proofs awaiting verification with the proof, request context and one-click verify or reject with reason, so that verification takes seconds each.
- A2. As Admin, I want to grant credits to any Seeker with a reason, so that I can support early testers and resolve disputes.
- A3. As Admin, I want a redemption log with vendor references, so that I can reconcile gift-card spend.
- A4. As Admin, I want abuse flags (duplicate pairs, same device across roles, velocity), so that I can review suspicious activity.
- A5. As Admin, I want to resolve interview disputes with evidence from both sides, so that tranche 2 and refunds are decided fairly.
- A6. As Admin, I want every admin action logged with before and after values, so that changes are auditable.
- A7. As Admin, I want to see job queue health and failed jobs, so that I notice when timers or the resume pipeline stop.
- A8. As Admin, I want to edit configuration values (packs, percentages, windows) with versioning, so that I can tune the product without a deploy.

### 7.4 Edge and error cases

- E1. Resume tailoring fails: the Seeker is told, nothing is charged, and they can retry.
- E2. Payment succeeded but the webhook was missed: credits appear after reconciliation and the Seeker is notified.
- E3. WhatsApp delivery fails: the same message goes by email within 15 minutes.
- E4. Insider's weekly cap reached: profile shows "not accepting this week" and cannot be selected.
- E5. Insider's verification expired: profile hidden from search; open requests continue to their outcome.
- E6. Proof rejected: request returns to the accepted state with the rejection reason; Insider can re-upload once.
- E7. Both parties report contradictory interview outcomes: request enters dispute; admin decides.

---

## 8. Requirements

### 8.1 P0 — Must have

**R1. Authentication.** Phone OTP, email OTP, Google sign-in for all users.
- Given a new visitor, when they complete any sign-in method, then an account exists and they land on onboarding.
- Given a returning user, when they sign in, then they land on the dashboard for their role.

**R2. Insider company-email verification.** Insiders must verify an email on a curated company domain by OTP; personal domains are rejected with an explanation.
- Given an Insider enters an email on an allowed domain, when they enter the OTP, then the profile shows a verified badge and a re-verification date 90 days out (configurable).
- Given an email on a non-allowed domain, when submitted, then the form explains why and the profile does not go live.

**R3. Re-verification.** Insiders are prompted before expiry; on expiry the profile is hidden until re-verified.
- Given the re-verification date passes without OTP, when a Seeker searches, then the Insider does not appear; open requests are unaffected.

**R4. Insider profile and preferences.** Role title, seniority, years of experience, up to three vouch roles, weekly cap (1–5), bio, display name or anonymous, availability toggle.
- Given the weekly cap is reached, when a Seeker views the profile, then sending is disabled with the reason.

**R5. Insider search.** Filter by company, role, seniority; sort by credit cost, rating, response time. Cards show verified badge, role, seniority, credit cost, vouches done, response rate.
- Given a company with no verified Insiders, when searched, then an empty state offers "notify me" (P1) and the resume tool.

**R6. Resume upload and tailoring.** Upload PDF/DOCX; provide job link or JD text; receive DOCX and PDF that follow ATS template rules, with a summary of what changed.
- Given a valid resume and job description, when tailoring is requested, then outputs are available within 45 seconds at p95 and listed on the dashboard.
- Given the pipeline fails, when the Seeker returns, then the failure is shown with a retry and nothing was charged.

**R7. Credit purchase.** Packs from configuration, checkout with UPI, card, netbanking; balance and transaction history.
- Given a successful payment, when the provider confirms, then the balance increases exactly once and a receipt is sent.
- Given a duplicate provider notification, when processed, then the balance does not change again.

**R8. Send Insider Request.** Choose a tailored resume, write a note (max 500 characters), see credit cost, confirm. Credits are escrowed at send time. Response clock starts.
- Given balance below cost, when the Seeker confirms, then they are redirected to credits with the draft preserved.
- Given sufficient balance, when confirmed, then the request appears in the Insider inbox and the Seeker timeline within seconds and the balance reflects the escrow.

**R9. Insider response.** Accept or decline within the response window; expiry auto-closes.
- Given no response by the deadline, when the timer fires, then the request is expired, credits are refunded per configuration, and both parties are notified.

**R10. Proof and verification.** Insider uploads screenshot or pastes email text; admin verifies or rejects with reason; verification releases tranche 1.
- Given verification, when admin confirms, then points appear in the Insider wallet as pending-to-available per configuration and the Seeker sees "Submitted".

**R11. Interview confirmation and window close.** Either party reports an interview; the other has a dispute window; unresolved disputes go to admin. Window expiry without an interview triggers the configured partial refund.
- Given a Seeker reports an interview and the Insider does not dispute within 48 hours, when the dispute window ends, then tranche 2 is released and the request completes.

**R12. Refund policy execution.** Every refund goes to the credit wallet with a visible reason and the rule version applied.

**R13. Points wallet and redemption.** Balance, pending, history; redeem above the configured minimum by brand and denomination; PAN captured when the configured lifetime threshold is reached. Redemption fulfilment may be manual at MVP.
- Given balance below minimum, when the Insider opens redeem, then the button is disabled with the threshold shown.

**R14. Notifications.** WhatsApp message for every state change with email fallback; user can toggle channels.

**R15. WhatsApp entry funnel.** Menu, company and role capture, resume intake, tailored resume delivery, Insider list, deep link with prefill.
- Given a deep link opened within its validity window, when the Seeker signs up, then company, role and resume are pre-filled and editable.

**R16. Admin console.** Proof queue, users with credit grant, redemption log, flags, disputes, job health, config editor, audit log.

**R17. Account deletion.** Seeker or Insider can delete their account; files and personal data are removed; ledger and audit records are retained in anonymised form.

### 8.2 P1 — Should have (fast follow)

- P1.1 "Notify me when an Insider verifies at my target company" using saved target companies.
- P1.2 Live status updates on the request page without refresh.
- P1.3 Insider credit cost auto-adjusts from track record using a configured formula.
- P1.4 Seeker can save a draft request and return to it.
- P1.5 Admin proof triage assisted by an LLM summary of the uploaded screenshot.
- P1.6 PWA install prompt and offline shell.

### 8.3 P2 — Future considerations (design for, do not build)

- P2.1 Private Insider leaderboard by response rate and success.
- P2.2 Native mobile app with swipe-based request flow.
- P2.3 Automated proof verification.
- P2.4 Multi-role accounts with one-tap switching (schema already supports `both`).
- P2.5 Localised UI strings.

---

## 9. Success metrics

### Leading (first 30 days after launch)

| Metric | Target | Source |
|---|---|---|
| Tailored resume to web signup | ≥ 40% | funnel events |
| Signup to first request sent | ≥ 30% of Seekers with a positive balance | funnel events |
| Insider response within 48h | ≥ 70% | request events |
| Proof verified within 24h of upload | ≥ 90% | admin events |
| Notification delivered within 60s | ≥ 99% | notifications table |
| Tailoring p95 latency | ≤ 45 s | job telemetry |
| Ledger reconciliation drift | 0 | nightly job |

### Lagging (90 days)

| Metric | Target |
|---|---|
| Requests reaching "interview confirmed" | ≥ 20% of accepted requests |
| Seekers sending a second request | ≥ 35% |
| Insiders completing a second vouch | ≥ 50% |
| Support-driven manual ledger adjustments | 0 |

---

## 10. Open questions

| # | Question | Owner | Blocking? |
|---|---|---|---|
| Q1 | Final configuration values: packs, request cost by tier, refund percentages, tranche split, windows, minimum redemption, free-credit grant | Founder | Yes, before Phase 1 exit; placeholders allowed until then |
| Q2 | Initial list of companies and allowed email domains for Insider verification | Founder | Yes, before Phase 1.2 |
| Q3 | WhatsApp BSP account and business number | Founder | Before Phase 2.4 |
| Q4 | Gift-card vendor choice | Founder | Before Phase 3.3 (manual fulfilment until then) |
| Q5 | Should a declined request expose the Insider's reason to the Seeker verbatim, or as a category? | Founder / design | Before Phase 1.6 |
| Q6 | Should Insiders see the Seeker's full name before accepting, or only after? | Founder / design | Before Phase 1.6 |
| Q7 | Keep or remove `framer-motion` from the landing page | Founder | Phase 0 |

---

## 11. Phasing

| Phase | Scope (PRD refs) | Exit criterion |
|---|---|---|
| 0 | Infrastructure, repo restructure, ledger and state machine, config, adapters, CI | Landing page served from the pipeline over TLS; ledger tests green |
| 1 | R1–R5, R8–R10, R12, R13 (manual fulfilment), R16, email notifications | 10 real requests completed end to end with manually granted credits |
| 2 | R6, R7, R11, R14 (WhatsApp outbound), abuse flags, monitoring | First paid pack; tailoring at target latency; all transitions notified |
| 3 | R15, real gift-card adapter, PAN gate, P1.2, P1.3 | WhatsApp funnel live; redemptions automated |
| 4 | P1.1, P1.4–P1.6, hardening | Ongoing |

---

## 12. Traceability

Each requirement above maps to a technical requirement in `TRD.md` (section 12, traceability matrix) and to backlog items in `AGENTS.md` Parts 3.11 and 4.9.
