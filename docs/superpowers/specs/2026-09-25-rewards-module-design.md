# Rewards Module — Design

Date: 2026-09-25. Status: draft for founder review. Sources: `AGENTS.md` §3.2/§3.3, `TRD.md` §4.1, §5, §6.1, §8, `PRD.md` R10/R13, `USER-FLOWS.md` §`/insider/rewards`, handoff §5.

## 1. Goal and success criteria

An Insider whose proof is verified earns points; the Insider sees a wallet and redeems points for a gift card that the founder fulfils by hand from `/admin`.

Success means:
- Every point movement is a zero-sum, idempotent ledger transaction, and points never share a ledger transaction with credits (TRD T-5.4).
- Tranche 1 is released **in the same database transaction** as the `verify` transition, so "proof verified but no points" cannot happen.
- A redemption can never overspend: balance is checked under an account lock (TRD T-5.5/T-5.6 pattern).
- Every admin redemption action writes `admin_audit_log`; the Insider is notified of each outcome through the notifications module.
- Business numbers come from `app_config` (AGENTS §0.5); none appear in code.
- Real-adapter code is exercised by an opt-in live test (lesson of 2026-09-25).

## 2. Scope

In: tranche release (`releaseTranche`) wired into `reviewProof(verify)` for tranche 1; tranche 2 implemented and tested but **not wired** (interview confirmation is undecided, handoff §5.2); wallet reads; redemption request; `GiftCardVendor` interface + `ManualFulfilmentVendor` + fake; admin fulfil/reject/list; three notification templates; tables `insider_rewards`, `reward_redemptions` (migration 0011); config additions; live test.

Out (and why): PAN gate/capture (AGENTS §3.11 schedules it for Phase 3; it stores sensitive data); a real gift-card vendor; all UI and server actions (frontend track); wiring tranche 2 to interview confirmation; weekly capacity; `authorize()` / actor identity (handoff §5.6, arrives with server actions — module functions take explicit ids).

## 3. Decisions

1. **Points formula:** `points(tranche) = round(request.creditCost × pointsPerCredit × trancheXPercent / 100)`, computed with the **request's stamped `rules_version`** (TRD T-6.3). Tranche percents already exist in `rules`; the remainder is the platform share.
2. **New config fields** (in `rules`, so they are versioned with it; all **optional in the Zod schema** so old rule versions still parse; rewards code throws `RewardsNotConfiguredError` if one it needs is absent): `pointsPerCredit` (int > 0), `paisePerPoint` (int > 0), `giftCardBrands` (non-empty string list). Seeded as **placeholders** as `rules` version 2: `pointsPerCredit` 40, `paisePerPoint` 100, `giftCardBrands` `["amazon","flipkart"]`. Requests stamped with version 1 in a dev database cannot earn points; acceptable pre-launch.
3. **Ledger accounts:** points flow `platform(points) → insider(points)` on release. The wallet owner is the **insider profile id** (same convention as seekers use `seeker_profiles.id`), not the user id used in the TRD table sketch; noted deviation. A redemption holds points in an `escrow(points)` account with `owner_id = redemptionId` (reusing the existing owner type, no check-constraint change): request `insider → escrow`, fulfilled `escrow → platform`, rejected `escrow → insider`.
4. **Bespoke atomic DB methods** (`Database.rewards.*`), the way `requests.sendRequest` is done, because generic `ledger.postTxn` neither locks accounts nor checks balances. Business logic stays in `src/modules/rewards`; the DB layer only guarantees atomicity.
5. **Tranche 1 atomicity:** `requests.applyTransition` input gains an optional `trancheRelease?: { insiderProfileId; tranche: 1 | 2; points: number }`. Inside the same DB transaction it posts the points ledger transaction (key `request:{id}:tranche:{n}`) and inserts the `insider_rewards` row. It is skipped when `points` is 0 and it is idempotent with the transition's own replay branch. Tranche 2 (future) uses the same helper via `Database.rewards.releaseTranche`.
6. **Vendor:** `GiftCardVendor.issue({ redemptionId, brand, denominationPaise }) → { status: "pending" | "issued"; vendorRef: string | null }`. `ManualFulfilmentVendor` always returns `pending` (the admin ticket is the redemption row itself). If a vendor returns `issued`, the module resolves the redemption as fulfilled immediately with no admin actor. Fake vendor is configurable for both outcomes.
7. **Redemption input:** `{ idempotencyKey, insiderProfileId, points, brand }`. Rules: integer points ≥ `minRedemptionPoints`; brand ∈ `giftCardBrands`; points ≤ balance at lock time; `denominationPaise = points × paisePerPoint`.

## 4. Data model (migration 0011, additive)

`insider_rewards`: `id` uuid pk, `request_id` uuid fk `insider_requests`, `insider_profile_id` uuid fk `insider_profiles`, `tranche` smallint check in (1,2), `points` int > 0, `ledger_txn_id` uuid fk `ledger_txns`, `released_at` timestamptz default now; unique `(request_id, tranche)`.

`reward_redemptions`: `id` uuid pk, `insider_profile_id` fk, `points` int > 0, `brand` text, `denomination_paise` int > 0, `vendor` text, `vendor_ref` text null, `status` text check in (`pending`,`fulfilled`,`rejected`), `reject_reason` text null, `idempotency_key` text unique, `created_at`, `resolved_at` null. Index `(status, created_at)` for the admin queue and `(insider_profile_id, created_at)` for history.

Neither table is append-only-restricted; `admin_audit_log` stays append-only.

## 5. Interfaces (module `src/modules/rewards`)

- `computeTranchePoints(rules, creditCost, tranche): number` — pure.
- `releaseTranche(deps, { requestId, tranche })` — loads request + its stamped rules, computes points, calls `db.rewards.releaseTranche`; returns the reward row or `null` when points = 0. Used by tranche 2 later; tranche 1 goes through `applyTransition`.
- `getWallet(deps, insiderProfileId)` → `{ balance, lifetimeEarned, pendingRedemptionPoints }`; `listRewards`, `listRedemptions(insiderProfileId)`.
- `requestRedemption(deps, input)` → redemption row. Errors: `BelowMinimumRedemptionError`, `UnknownBrandError`, `InsufficientPointsError`, `RewardsNotConfiguredError`.
- Admin (`src/modules/admin`): `listRedemptions(deps, status?)`, `fulfilRedemption(deps, { idempotencyKey, adminUserId, redemptionId, vendorRef })`, `rejectRedemption(deps, { …, reason })` (reason required). Resolve only from `pending` (`RedemptionAlreadyResolvedError` otherwise; a replay of the same key returns the current row).
- `Database.rewards`: `releaseTranche`, `createRedemption` (lock insider points account `FOR UPDATE`, check balance, post hold txn `redemption:{id}:hold`, insert row, all in one transaction, idempotent on `idempotency_key`), `resolveRedemption` (pending → fulfilled|rejected, ledger txn `redemption:{id}:fulfil|reject`, optional `adminAudit`, one transaction), `getRedemptionById`, `listRedemptions`, `listRewards`, `getWallet`.

## 6. Flows

- **Verify:** `reviewProof(verify)` computes tranche-1 points from the request's rules version and passes `trancheRelease` to `applyTransition`; after commit it notifies the Insider `reward.released` (event key = the transition key, existing notify dedupe applies). A computation failure (e.g. `RewardsNotConfiguredError`) must not silently verify without points: it aborts before the transition.
- **Redeem:** validate → `db.rewards.createRedemption` → `vendor.issue` → (`issued` → resolve fulfilled) → return row. A vendor call failure leaves the redemption `pending` (admin sees it) and is logged; it does not refund.
- **Admin fulfil/reject:** `resolveRedemption` + audit; then notify `redemption.fulfilled` / `redemption.rejected` (with reason).

Notification templates (copy uses `brand.name`, locked vocabulary "Insider Rewards", "points"): `reward.released` `{ requestId, tranche, points, companyName }`, `redemption.fulfilled` `{ redemptionId, brand, points }`, `redemption.rejected` `{ redemptionId, points, reason }`. Email HTML escapes user values; subjects plain text (lessons from the notifications module).

## 7. Testing and verification

- Vitest with fakes: `computeTranchePoints` exhaustively (rounding, 0, both tranches, per-version rules); every module function happy path plus each error; property-style test that random sequences of release/redeem/fulfil/reject never make a balance negative and always net to zero across `platform`, `insider`, `escrow(points)`; replay of every idempotent operation is a no-op; verify path: points and transition commit or fail together; notifications sent once.
- 100% branch coverage for `computeTranchePoints` and the redemption state logic (AGENTS §3.8).
- **Live test (opt-in `RUN_VENDOR_TESTS=1`, dev Postgres):** real `Database.rewards.*` — release idempotency, concurrent redemptions cannot overspend (two overlapping `createRedemption` calls for more than the balance: exactly one succeeds), resolve pending→fulfilled/rejected ledger effects, `applyTransition` with `trancheRelease` atomicity and replay. Also extend the earlier live test so a failure in the real adapter is visible before merge.
- Model tiers per handoff §6: the DB layer, `applyTransition` change and `reviewProof` wiring are money/idempotency → opus reviews; templates, vendor, admin list → sonnet.

## 8. Risks and follow-ups

- Placeholder points economics (40 points per credit, ₹1 per point) are founder-owned; changing them is a new `rules` version, no code change.
- The unresolved interview-confirmation design (handoff §5.2) blocks tranche 2 wiring only.
- The PAN gate must land before real redemptions; it will add a lifetime-redeemed check in `requestRedemption` and PAN storage (encrypted), reviewed as security-sensitive.
- `authorize()` and actor identity for `requestRedemption` arrive with server actions.
- Notification hard gate from handoff §1 (`notify.send` dedupe) still applies before real email/WhatsApp adapters.
