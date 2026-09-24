# Rewards Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insiders earn points when a proof is verified, see a wallet, and redeem points for a gift card that the founder fulfils by hand from `/admin`; every points movement is a zero-sum, idempotent, atomic ledger transaction.

**Architecture:** Points are a separate ledger currency. Points moves live in bespoke atomic `Database.rewards.*` methods (lock → check → ledger → row in one transaction, as `requests.sendRequest` does), because generic `ledger.postTxn` neither locks nor checks balances. Tranche 1 is released inside the `verify` transition through a new optional `trancheRelease` on `applyTransition`. Redemptions hold points in an `escrow(points)` account keyed by redemption id. Business logic (`computeTranchePoints`, validation, vendor call, notifications) lives in `src/modules/rewards` and `src/modules/admin`.

**Tech Stack:** Drizzle + drizzle-kit, Zod, Vitest, pg-boss (via notifications). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-25-rewards-module-design.md` (approved by the founder 2026-09-25). The spec is the authority; where this plan and AGENTS.md disagree, AGENTS.md wins.

## Global Constraints

- TypeScript strict, no `any`, no `@ts-ignore`; Zod at every boundary (AGENTS.md Part 2.1).
- Domain modules (`src/modules/*`) import no Next.js, no Drizzle client, no vendor SDK; they get `Database`/`QueueClient`/`GiftCardVendor` through a `deps` object (Part 2.2). Every vendor sits behind an interface with a fake (Part 2.3).
- Idempotency keys embed the entity id and derive from the triggering event: `request:{id}:tranche:{n}` (points ledger txn), `redemption:{id}:hold`, `redemption:{id}:fulfil`, `redemption:{id}:reject`, redemption request `redemption:{insiderProfileId}:{callerKey}`.
- Points and credits NEVER share a ledger transaction (TRD T-5.4). Every points transaction is zero-sum per currency.
- Append-only tables (`request_events`, `ledger_entries`, `admin_audit_log`) are never updated or deleted (Part 2.5). Every admin mutation writes `admin_audit_log` (§3.6) in the same DB transaction as the change.
- No business-number literals in domain code (§0.5): points-per-credit, paise-per-point, brands, tranche percents, minimum redemption all come from `rules` in `app_config` via `getRulesWithVersion`. Tranche points use the **request's stamped `rulesVersion`** (TRD T-6.3).
- Locked vocabulary: Insider, Seeker, Insider Request, vouch, credits, points, "Insider Rewards" — never referrer/refer/payout. Copy uses `brand.name`. Email HTML escapes user-controlled values (`escapeHtml`, body only); subjects stay plain text.
- Migrations are generated with drizzle-kit and are additive; inspect the SQL before committing. Do not add dependencies (Part 2.11). Small verified commits; run `npm run lint && npm run typecheck && npm test` once before each commit (Part 2.10). Never commit to `main` directly.
- Notification side effects go through `notify(deps, userId, template, payload, eventKey)` inside try/catch so a notification failure never fails the mutation (established pattern).
- **Real-adapter code (`src/adapters/db/real.ts`) is verified only by Task 7's live test.** Fakes cannot catch SQL/vendor-library problems (lesson of 2026-09-25). Run `npm test` WITHOUT exporting `.env.local` (ADAPTERS=real breaks `env.test.ts`); run the live test with env exported in a subshell.
- Out of scope, explicitly: PAN gate/capture; a real gift-card vendor; any UI or server action; wiring tranche 2 to interview confirmation (implemented and tested, not called); `authorize()`/actor identity for `requestRedemption`; the `notify.send` dedupe hard gate.

## Review Focus

- **Overspend under concurrency.** Two overlapping `createRedemption` calls whose total exceeds the balance: exactly one may succeed (account row locked `FOR UPDATE` before the balance read). Task 3 tests the fake logic; Task 7 proves it on real Postgres.
- **Verified proof without points, or points without verification.** Tranche 1 and the `verify` transition commit or fail together; a `RewardsNotConfiguredError` aborts verify before any state change. Task 6's tests pin both directions.
- **Replay safety.** Replaying `applyTransition(verify)`, `releaseTranche`, `createRedemption`, `resolveRedemption` (same outcome) changes nothing and sends no second notification; a conflicting resolve (fulfil after reject) throws `RedemptionAlreadyResolvedError`. Tasks 2, 3, 5, 6.
- **A redemption whose vendor call fails must stay `pending`** (visible to the admin), never silently vanish or refund, and the vendor must not be called again on an idempotent replay. Task 5.
- **Config gaps.** A `rules` version without `pointsPerCredit`/`paisePerPoint`/`giftCardBrands` must fail with `RewardsNotConfiguredError` rather than compute `NaN` or pay 0. Task 1 and Task 5.

## Task Tiers (set `model` explicitly on every dispatch)

| Task | Implementer | Reviewer |
|---|---|---|
| 1 Config fields, seed, `computeTranchePoints` | sonnet | sonnet |
| 2 Schema + migration 0011, types, tranche release in DB (fake + real), `applyTransition.trancheRelease` | sonnet | opus (money, atomicity) |
| 3 Redemption DB layer (fake + real), wallet | sonnet | opus (locking, overspend) |
| 4 `GiftCardVendor` + manual + fake, adapters wiring, 3 notification templates | sonnet | sonnet |
| 5 `rewards` module (`releaseTranche`, wallet reads, `requestRedemption`) | sonnet | opus (money, replay) |
| 6 Admin fulfil/reject/list + `reviewProof` tranche-1 wiring | sonnet | opus (money, atomicity) |
| 7 Live integration test | sonnet | sonnet |
| Final whole-branch review | — | opus |

---

## Task 1: Config fields, seed, and `computeTranchePoints`

**Files:**
- Modify: `src/modules/config/schemas.ts`, `src/modules/config/config.test.ts` (or the existing config schema test file — check which exists)
- Modify: `scripts/seed.ts`
- Create: `src/modules/rewards/points.ts`, `src/modules/rewards/points.test.ts`

**Interfaces:**
- Produces: `Rules` gains optional `pointsPerCredit?: number`, `paisePerPoint?: number`, `giftCardBrands?: string[]`; `RewardsNotConfiguredError`; `computeTranchePoints(rules: Rules, creditCost: number, tranche: 1 | 2): number`; `requireRewardsConfig(rules: Rules): { pointsPerCredit: number; paisePerPoint: number; giftCardBrands: string[] }` (throws `RewardsNotConfiguredError` naming the first missing field).

- [ ] **Step 1: Failing tests** — create `src/modules/rewards/points.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import type { Rules } from "../config/schemas";
import { computeTranchePoints, requireRewardsConfig, RewardsNotConfiguredError } from "./points";

const BASE: Rules = {
  responseWindowHours: 48,
  interviewWindowDays: 14,
  reverificationDays: 90,
  tranche1Percent: 50,
  tranche2Percent: 50,
  refundPercentOnDecline: 100,
  refundPercentOnExpiry: 60,
  minRedemptionPoints: 500,
  panThresholdPoints: 5000,
  freeCreditGrant: 3,
  requestCostByTier: { tier1: 3, tier2: 2, tier3: 1 },
  pointsPerCredit: 40,
  paisePerPoint: 100,
  giftCardBrands: ["amazon", "flipkart"],
};

describe("computeTranchePoints", () => {
  it("pays creditCost x pointsPerCredit x tranche percent for tranche 1 and 2", () => {
    expect(computeTranchePoints(BASE, 3, 1)).toBe(60);
    expect(computeTranchePoints(BASE, 3, 2)).toBe(60);
  });

  it("uses each tranche's own percent and leaves the remainder to the platform", () => {
    const rules = { ...BASE, tranche1Percent: 30, tranche2Percent: 50 };
    expect(computeTranchePoints(rules, 3, 1)).toBe(36);
    expect(computeTranchePoints(rules, 3, 2)).toBe(60);
  });

  it("rounds to the nearest whole point", () => {
    const rules = { ...BASE, pointsPerCredit: 7, tranche1Percent: 50 };
    expect(computeTranchePoints(rules, 1, 1)).toBe(4); // 3.5 -> 4
    expect(computeTranchePoints({ ...rules, tranche1Percent: 10 }, 1, 1)).toBe(1); // 0.7 -> 1
  });

  it("returns 0 for a 0 percent tranche", () => {
    expect(computeTranchePoints({ ...BASE, tranche2Percent: 0 }, 3, 2)).toBe(0);
  });

  it("throws RewardsNotConfiguredError naming pointsPerCredit when it is absent", () => {
    const { pointsPerCredit: _omit, ...rest } = BASE;
    expect(() => computeTranchePoints(rest as Rules, 3, 1)).toThrow(RewardsNotConfiguredError);
    expect(() => computeTranchePoints(rest as Rules, 3, 1)).toThrow(/pointsPerCredit/);
  });
});

describe("requireRewardsConfig", () => {
  it("returns the three fields when all are present", () => {
    expect(requireRewardsConfig(BASE)).toEqual({ pointsPerCredit: 40, paisePerPoint: 100, giftCardBrands: ["amazon", "flipkart"] });
  });

  it("names the first missing field", () => {
    expect(() => requireRewardsConfig({ ...BASE, paisePerPoint: undefined })).toThrow(/paisePerPoint/);
    expect(() => requireRewardsConfig({ ...BASE, giftCardBrands: undefined })).toThrow(/giftCardBrands/);
  });
});
```
(`_omit` unused-var: if lint objects, build the object without the key another way; keep no `any`.) In the config schema test file add a test that `rulesSchema.parse` accepts a rules object WITH the three new fields and one WITHOUT them (old versions must still parse), and rejects `pointsPerCredit: 0` and `giftCardBrands: []`.

- [ ] **Step 2: Run to verify RED** — `npx vitest run src/modules/rewards/points.test.ts` (module missing).

- [ ] **Step 3: Implement.** In `src/modules/config/schemas.ts` add to `rulesSchema` (after `requestCostByTier`):
```ts
  pointsPerCredit: z.number().int().positive().optional(),
  paisePerPoint: z.number().int().positive().optional(),
  giftCardBrands: z.array(z.string().min(1)).min(1).optional(),
```
Create `src/modules/rewards/points.ts`:
```ts
import type { Rules } from "../config/schemas";

export class RewardsNotConfiguredError extends Error {
  constructor(field: string) {
    super(`Rewards config is missing "${field}" in the rules version in use`);
    this.name = "RewardsNotConfiguredError";
  }
}

export function requireRewardsConfig(rules: Rules): {
  pointsPerCredit: number;
  paisePerPoint: number;
  giftCardBrands: string[];
} {
  if (rules.pointsPerCredit === undefined) throw new RewardsNotConfiguredError("pointsPerCredit");
  if (rules.paisePerPoint === undefined) throw new RewardsNotConfiguredError("paisePerPoint");
  if (rules.giftCardBrands === undefined) throw new RewardsNotConfiguredError("giftCardBrands");
  return {
    pointsPerCredit: rules.pointsPerCredit,
    paisePerPoint: rules.paisePerPoint,
    giftCardBrands: rules.giftCardBrands,
  };
}

export function computeTranchePoints(rules: Rules, creditCost: number, tranche: 1 | 2): number {
  if (rules.pointsPerCredit === undefined) throw new RewardsNotConfiguredError("pointsPerCredit");
  const percent = tranche === 1 ? rules.tranche1Percent : rules.tranche2Percent;
  return Math.round((creditCost * rules.pointsPerCredit * percent) / 100);
}
```
In `scripts/seed.ts` add, after `PLACEHOLDER_RULES`:
```ts
// Rewards economics are founder-owned placeholders (spec 2026-09-25). New rules VERSION so
// existing version-1 rows (and requests stamped with them) are untouched.
const PLACEHOLDER_RULES_V2 = {
  ...PLACEHOLDER_RULES,
  version: 2,
  value: { ...PLACEHOLDER_RULES.value, pointsPerCredit: 40, paisePerPoint: 100, giftCardBrands: ["amazon", "flipkart"] },
};
```
and after the first `appConfig` insert: `await db.insert(appConfig).values(PLACEHOLDER_RULES_V2).onConflictDoNothing();`; update the log line to mention rules v2.

- [ ] **Step 4: Verify and commit.** Focused tests green, then once `npm run lint && npm run typecheck && npm test`. Also run `npm run db:seed` against the dev DB once (env exported in a subshell) and confirm no error; confirm with `docker exec infra-postgres-1 psql -U getnudgd -d getnudgd -c "select key, version, placeholder from app_config order by key, version"` that `rules` has versions 1 and 2. Commit: `feat(rewards): add rewards config fields, seed rules v2 and computeTranchePoints`.

---

## Task 2: Schema + migration 0011, types, tranche release (fake + real), `applyTransition.trancheRelease`

**Files:**
- Modify: `drizzle/schema.ts`; create (generated) `drizzle/migrations/0011_*.sql` + meta
- Modify: `src/adapters/db/types.ts`, `src/adapters/db/fake.ts`, `src/adapters/db/real.ts`, `src/adapters/db/fake.test.ts`

**Interfaces:**
- Produces (types.ts):
```ts
export type RedemptionStatus = "pending" | "fulfilled" | "rejected";

export interface InsiderRewardRecord {
  id: string;
  requestId: string;
  insiderProfileId: string;
  tranche: number;
  points: number;
  ledgerTxnId: string;
  releasedAt: Date;
}

export interface RewardRedemptionRecord {
  id: string;
  insiderProfileId: string;
  points: number;
  brand: string;
  denominationPaise: number;
  vendor: string;
  vendorRef: string | null;
  status: RedemptionStatus;
  rejectReason: string | null;
  idempotencyKey: string;
  createdAt: Date;
  resolvedAt: Date | null;
}

export interface TrancheReleaseInput {
  insiderProfileId: string;
  tranche: 1 | 2;
  points: number;
}

export interface ReleaseTrancheInput extends TrancheReleaseInput {
  requestId: string;
}
```
`ApplyRequestTransitionInput` gains `trancheRelease?: TrancheReleaseInput;`. `Database.rewards` (this task): `releaseTranche(input: ReleaseTrancheInput): Promise<InsiderRewardRecord>` and `listRewards(insiderProfileId: string): Promise<InsiderRewardRecord[]>` (newest first). Task 3 adds the redemption methods to the same object.

- [ ] **Step 1: Failing tests** in `src/adapters/db/fake.test.ts`, new `describe("createFakeDatabase rewards (tranche release)", …)`. Reuse the file's existing helpers to build a seeker with credits, a verified insider and a request (see the existing `sendRequest`/`applyTransition` tests):
  1. `releaseTranche` posts a zero-sum points txn (`platform` −points, `insider` +points), returns a reward row with the right fields, and `ledger.getBalance("insider", insiderProfileId, "points")` equals `points`.
  2. `releaseTranche` twice with the same `(requestId, tranche)` returns the same reward id and leaves the balance unchanged (idempotent); tranche 1 and tranche 2 for the same request are two rows and the balance is the sum.
  3. `releaseTranche` rejects `points <= 0` (throws).
  4. `listRewards` returns rows newest-first and only for that insider.
  5. `applyTransition` with `trancheRelease` (verify a PROOF_PENDING request: drive a request through sendRequest → accept → submitProof using existing db methods, then verify) commits the state change AND the reward together; replaying the same transition key changes nothing (one reward row, one balance); with `trancheRelease.points` 0 it releases nothing.
  6. Credits and points never share a txn: assert every txn posted by `releaseTranche` has entries of one currency only.
- [ ] **Step 2: RED** — `npx vitest run src/adapters/db/fake.test.ts` fails (missing `db.rewards`).
- [ ] **Step 3: Schema** — in `drizzle/schema.ts` add (mirroring the file's existing table style/imports; add `smallint` if you use it, else `integer`):
```ts
export const insiderRewards = pgTable(
  "insider_rewards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id").notNull().references(() => insiderRequests.id),
    insiderProfileId: uuid("insider_profile_id").notNull().references(() => insiderProfiles.id),
    tranche: integer("tranche").notNull(),
    points: integer("points").notNull(),
    ledgerTxnId: uuid("ledger_txn_id").notNull().references(() => ledgerTxns.id),
    releasedAt: timestamp("released_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    trancheCheck: check("insider_rewards_tranche_check", sql`${table.tranche} in (1, 2)`),
    pointsCheck: check("insider_rewards_points_check", sql`${table.points} > 0`),
    requestTrancheUq: uniqueIndex("insider_rewards_request_tranche_uq").on(table.requestId, table.tranche),
    insiderIdx: index("insider_rewards_insider_profile_id_idx").on(table.insiderProfileId),
  })
);

export const rewardRedemptions = pgTable(
  "reward_redemptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    insiderProfileId: uuid("insider_profile_id").notNull().references(() => insiderProfiles.id),
    points: integer("points").notNull(),
    brand: text("brand").notNull(),
    denominationPaise: integer("denomination_paise").notNull(),
    vendor: text("vendor").notNull(),
    vendorRef: text("vendor_ref"),
    status: text("status").notNull().default("pending"),
    rejectReason: text("reject_reason"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => ({
    statusCheck: check("reward_redemptions_status_check", sql`${table.status} in ('pending','fulfilled','rejected')`),
    pointsCheck: check("reward_redemptions_points_check", sql`${table.points} > 0`),
    denominationCheck: check("reward_redemptions_denomination_check", sql`${table.denominationPaise} > 0`),
    idempotencyKeyUq: uniqueIndex("reward_redemptions_idempotency_key_uq").on(table.idempotencyKey),
    statusCreatedIdx: index("reward_redemptions_status_created_idx").on(table.status, table.createdAt),
    insiderCreatedIdx: index("reward_redemptions_insider_created_idx").on(table.insiderProfileId, table.createdAt),
  })
);
```
Then `npm run db:generate -- --name rewards_tables`; the SQL must contain ONLY the two CREATE TABLE statements, their constraints/FKs and indexes — anything else (drops, other tables) → stop and report BLOCKED.
- [ ] **Step 4: Types + fake.** Add the types above. In `fake.ts` add `const rewardRows: InsiderRewardRecord[] = [];` and a local helper mirroring the existing txn-building code:
```ts
  function postTxnInternal(idempotencyKey: string, eventType: string, entries: PostLedgerEntryInput[]): LedgerTxnRecord {
    const existing = txns.find((t) => t.idempotencyKey === idempotencyKey);
    if (existing) return existing;
    assertZeroSum(entries);
    const txnId = genId();
    const built = entries.map((e) => {
      const account = findOrCreateAccount(e.ownerType, e.ownerId, e.currency);
      return { id: genId(), txnId, accountId: account.id, currency: e.currency, amount: e.amount };
    });
    const txn: LedgerTxnRecord = { id: txnId, idempotencyKey, eventType, createdAt: new Date(), entries: built };
    txns.push(txn);
    return txn;
  }

  function releaseTrancheInternal(input: ReleaseTrancheInput): InsiderRewardRecord {
    if (input.points <= 0) throw new Error("Tranche points must be positive");
    const existing = rewardRows.find((r) => r.requestId === input.requestId && r.tranche === input.tranche);
    if (existing) return existing;
    const txn = postTxnInternal(`request:${input.requestId}:tranche:${input.tranche}`, "reward.tranche", [
      { ownerType: "platform", ownerId: "platform", currency: "points", amount: -input.points },
      { ownerType: "insider", ownerId: input.insiderProfileId, currency: "points", amount: input.points },
    ]);
    const reward: InsiderRewardRecord = {
      id: genId(),
      requestId: input.requestId,
      insiderProfileId: input.insiderProfileId,
      tranche: input.tranche,
      points: input.points,
      ledgerTxnId: txn.id,
      releasedAt: new Date(),
    };
    rewardRows.push(reward);
    return reward;
  }
```
(`PostLedgerEntryInput` is the existing entry type used by `applyTransition`; import it if needed.) Add to the fake `db`:
```ts
    rewards: {
      async releaseTranche(input) {
        return releaseTrancheInternal(input);
      },
      async listRewards(insiderProfileId) {
        return rewardRows
          .filter((r) => r.insiderProfileId === insiderProfileId)
          .sort((a, b) => b.releasedAt.getTime() - a.releasedAt.getTime());
      },
    },
```
and in the fake `requests.applyTransition`, immediately after the `ledgerEntries` block and before the `adminAudit` block: `if (input.trancheRelease && input.trancheRelease.points > 0) { releaseTrancheInternal({ requestId: input.requestId, ...input.trancheRelease }); }`. (Note the fake sorts newest-first by `releasedAt`; two rows in one millisecond keep insertion order via stable sort only if you sort ascending then reverse — implement so newest-inserted comes first: `[...rows].reverse()` is acceptable and deterministic; pick that if the timestamp sort makes your ordering test flaky.)
- [ ] **Step 5: Real.** In `src/adapters/db/real.ts`, inside `createRealDatabase`, add (importing `insiderRewards` from the schema, plus `desc` already imported):
```ts
  type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

  // Posts a ledger transaction inside an open transaction: find-or-create each account
  // (locking existing rows FOR UPDATE), insert the txn and its entries. Returns the txn id.
  async function postEntriesInTx(
    tx: Tx,
    idempotencyKey: string,
    eventType: string,
    entries: PostLedgerEntryInput[]
  ): Promise<string> {
    assertZeroSum(entries);
    const [txnRow] = await tx.insert(ledgerTxns).values({ idempotencyKey, eventType }).returning();
    for (const entry of entries) {
      let [account] = await tx
        .select()
        .from(ledgerAccounts)
        .where(
          and(
            eq(ledgerAccounts.ownerType, entry.ownerType),
            eq(ledgerAccounts.ownerId, entry.ownerId),
            eq(ledgerAccounts.currency, entry.currency)
          )
        )
        .for("update");
      if (!account) {
        [account] = await tx
          .insert(ledgerAccounts)
          .values({ ownerType: entry.ownerType, ownerId: entry.ownerId, currency: entry.currency })
          .returning();
      }
      await tx.insert(ledgerEntries).values({ txnId: txnRow.id, accountId: account.id, currency: entry.currency, amount: entry.amount });
    }
    return txnRow.id;
  }

  async function releaseTrancheInTx(tx: Tx, input: ReleaseTrancheInput): Promise<InsiderRewardRecord> {
    if (input.points <= 0) throw new Error("Tranche points must be positive");
    const [existing] = await tx
      .select()
      .from(insiderRewards)
      .where(and(eq(insiderRewards.requestId, input.requestId), eq(insiderRewards.tranche, input.tranche)));
    if (existing) return existing as InsiderRewardRecord;
    const ledgerTxnId = await postEntriesInTx(tx, `request:${input.requestId}:tranche:${input.tranche}`, "reward.tranche", [
      { ownerType: "platform", ownerId: "platform", currency: "points", amount: -input.points },
      { ownerType: "insider", ownerId: input.insiderProfileId, currency: "points", amount: input.points },
    ]);
    const [row] = await tx
      .insert(insiderRewards)
      .values({
        requestId: input.requestId,
        insiderProfileId: input.insiderProfileId,
        tranche: input.tranche,
        points: input.points,
        ledgerTxnId,
      })
      .returning();
    return row as InsiderRewardRecord;
  }
```
(Place these where `db` is in scope, before the returned object; if `createRealDatabase`'s structure makes `db` unavailable there, place them right after the `const` that holds it — read the top of the function first.) Add to the returned object:
```ts
    rewards: {
      async releaseTranche(input) {
        return db.transaction((tx) => releaseTrancheInTx(tx, input));
      },
      async listRewards(insiderProfileId) {
        const rows = await db
          .select()
          .from(insiderRewards)
          .where(eq(insiderRewards.insiderProfileId, insiderProfileId))
          .orderBy(desc(insiderRewards.releasedAt));
        return rows as InsiderRewardRecord[];
      },
    },
```
and in real `requests.applyTransition`, after the `input.ledgerEntries.length > 0` ledger block and before the `adminAudit` block: `if (input.trancheRelease && input.trancheRelease.points > 0) { await releaseTrancheInTx(tx, { requestId: input.requestId, ...input.trancheRelease }); }`. Do not refactor the existing inlined ledger code.
- [ ] **Step 6: Verify and commit.** Focused: `npx vitest run src/adapters/db/fake.test.ts`; then once `npm run lint && npm run typecheck && npm test`. Commit: `feat(rewards): add reward tables, tranche release and applyTransition trancheRelease`.

---

## Task 3: Redemption DB layer (fake + real) and wallet

**Files:**
- Modify: `src/adapters/db/types.ts`, `src/adapters/db/fake.ts`, `src/adapters/db/real.ts`, `src/adapters/db/fake.test.ts`

**Interfaces:**
- Consumes: Task 2's tables, `postEntriesInTx`/`Tx` (real), `postTxnInternal` (fake), `RewardRedemptionRecord`, `AdminAuditInput`.
- Produces (types.ts):
```ts
export interface CreateRedemptionInput {
  idempotencyKey: string;
  insiderProfileId: string;
  points: number;
  brand: string;
  denominationPaise: number;
  vendor: string;
}

export interface ResolveRedemptionInput {
  redemptionId: string;
  outcome: "fulfilled" | "rejected";
  vendorRef?: string;
  rejectReason?: string;
  adminAudit?: AdminAuditInput;
}

export interface WalletSummary {
  balance: number;
  lifetimeEarned: number;
  pendingRedemptionPoints: number;
}

export class InsufficientPointsError extends Error {
  constructor(insiderProfileId: string, required: number, available: number) {
    super(`Insider ${insiderProfileId} needs ${required} points but has ${available}`);
    this.name = "InsufficientPointsError";
  }
}

export class RedemptionAlreadyResolvedError extends Error {
  constructor(redemptionId: string, status: RedemptionStatus) {
    super(`Redemption ${redemptionId} is already ${status}`);
    this.name = "RedemptionAlreadyResolvedError";
  }
}
```
`Database.rewards` gains: `createRedemption(input: CreateRedemptionInput): Promise<{ redemption: RewardRedemptionRecord; created: boolean }>`; `resolveRedemption(input: ResolveRedemptionInput): Promise<RewardRedemptionRecord>`; `getRedemptionById(id: string): Promise<RewardRedemptionRecord | null>`; `listRedemptions(filter?: { status?: RedemptionStatus; insiderProfileId?: string }): Promise<RewardRedemptionRecord[]>` (newest first); `getWallet(insiderProfileId: string): Promise<WalletSummary>`.

Behaviour contract:
- `createRedemption`: idempotent on `idempotencyKey` (replay → `{ redemption: existing, created: false }`, no second hold). Otherwise, under a lock on the insider's `points` account (real: `SELECT … FOR UPDATE`), read the balance; `balance < points` (or no account) → throw `InsufficientPointsError`; insert the redemption row (`status: "pending"`); post txn key `redemption:{id}:hold` with entries `insider(insiderProfileId, points) −points` and `escrow(redemptionId, points) +points`. Points must be a positive integer (else throw).
- `resolveRedemption`: lock the redemption row. Unknown id → throw `Error("Redemption … not found")`. If `status === outcome` → return it unchanged (idempotent replay; no ledger, no audit). If status is not `pending` (and differs from outcome) → throw `RedemptionAlreadyResolvedError`. `fulfilled`: post txn `redemption:{id}:fulfil` `escrow −points`, `platform(points) +points`; set `status`, `vendorRef` (if given), `resolvedAt`. `rejected`: `rejectReason` required (throw if empty); post txn `redemption:{id}:reject` `escrow −points`, `insider +points`. If `adminAudit` is given, insert the `admin_audit_log` row in the same transaction.
- `getWallet`: `balance` = points-ledger balance of the insider account (0 if none); `lifetimeEarned` = sum of `insider_rewards.points`; `pendingRedemptionPoints` = sum of `pending` redemptions' points.

- [ ] **Step 1: Failing tests** in `fake.test.ts`, `describe("createFakeDatabase rewards (redemptions)", …)`. Helper: give an insider a points balance with `db.rewards.releaseTranche` on a real request (reuse Task 2's helper) — e.g. two tranches of 60 → 120 points. Tests:
  1. `createRedemption` debits the insider and credits the redemption escrow (balance of `insider` points −points; `escrow` account `redemptionId` = +points), returns `created: true`, status `pending`, correct fields.
  2. Replay with the same key → `created: false`, same id, no second debit.
  3. `points > balance` → `InsufficientPointsError`, nothing posted (balance unchanged, no row); `points` 0 / negative / non-integer → throws.
  4. Two sequential redemptions whose total exceeds the balance: first ok, second `InsufficientPointsError` (balance never negative).
  5. `resolveRedemption(fulfilled)`: escrow → platform, status `fulfilled`, `vendorRef` saved, `resolvedAt` set; insider balance stays reduced; the audit row is written when `adminAudit` is given.
  6. `resolveRedemption(rejected)`: escrow → insider (balance restored), `rejectReason` saved; rejecting without a reason throws and changes nothing.
  7. Replay of the same outcome returns the row unchanged and writes NO second ledger txn/audit; the opposite outcome after resolution → `RedemptionAlreadyResolvedError`; unknown id → throws.
  8. Property-style test: run 200 random operations (seeded PRNG, not `Math.random`) of release / redeem / fulfil / reject over a few insiders and assert after each step: insider balance ≥ 0; `sum(platform points) + sum(insider points) + sum(escrow points) === 0`; every txn is zero-sum and single-currency.
  9. `getWallet`: after two tranches (120) and one pending redemption of 100 → `{ balance: 20, lifetimeEarned: 120, pendingRedemptionPoints: 100 }`; after fulfil `pendingRedemptionPoints` 0; after reject on another, balance restored.
  10. `listRedemptions` filters by status and by insider, newest first.
- [ ] **Step 2: RED**, then **Step 3: fake implementation** — add `redemptionRows: RewardRedemptionRecord[]` and the `Database.rewards` methods implementing the contract (use `postTxnInternal`; balances via the existing account/txns helpers; for the lifetime sum use `rewardRows`; `adminAuditLogRows.push` exactly as `applyTransition` does). `createRedemption` id via `genId()`; the hold txn key uses that id.
- [ ] **Step 4: Real implementation** — types/imports for `rewardRedemptions`, `adminAuditLog`, `sum` (already imported); implement with `db.transaction`. Skeleton to follow exactly:
```ts
      async createRedemption(input) {
        if (!Number.isInteger(input.points) || input.points <= 0) throw new Error("Redemption points must be a positive integer");
        return db.transaction(async (tx) => {
          const [existing] = await tx.select().from(rewardRedemptions).where(eq(rewardRedemptions.idempotencyKey, input.idempotencyKey));
          if (existing) return { redemption: existing as RewardRedemptionRecord, created: false };

          const [account] = await tx
            .select()
            .from(ledgerAccounts)
            .where(and(eq(ledgerAccounts.ownerType, "insider"), eq(ledgerAccounts.ownerId, input.insiderProfileId), eq(ledgerAccounts.currency, "points")))
            .for("update");
          let balance = 0;
          if (account) {
            const [row] = await tx.select({ total: sum(ledgerEntries.amount) }).from(ledgerEntries).where(eq(ledgerEntries.accountId, account.id));
            balance = Number(row?.total ?? 0);
          }
          if (balance < input.points) throw new InsufficientPointsError(input.insiderProfileId, input.points, balance);

          const [row] = await tx
            .insert(rewardRedemptions)
            .values({
              insiderProfileId: input.insiderProfileId,
              points: input.points,
              brand: input.brand,
              denominationPaise: input.denominationPaise,
              vendor: input.vendor,
              status: "pending",
              idempotencyKey: input.idempotencyKey,
            })
            .returning();
          await postEntriesInTx(tx, `redemption:${row.id}:hold`, "reward.redemption.hold", [
            { ownerType: "insider", ownerId: input.insiderProfileId, currency: "points", amount: -input.points },
            { ownerType: "escrow", ownerId: row.id, currency: "points", amount: input.points },
          ]);
          return { redemption: row as RewardRedemptionRecord, created: true };
        });
      },
```
A unique-violation race on `idempotency_key` (two concurrent first calls with the same key) surfaces as a Postgres error; catch it once (`code === "23505"` on `reward_redemptions_idempotency_key_uq`) and re-read the row to return `{ created: false }`. `resolveRedemption` (`SELECT … FOR UPDATE` on the redemption row, then the contract above, audit insert included), `getRedemptionById`, `listRedemptions` (`and(...)` of optional filters, `orderBy(desc(createdAt))`) and `getWallet` (three aggregate queries) follow the contract. Do not use `ledger.postTxn`.
- [ ] **Step 5: Verify and commit** — focused fake tests; then once lint/typecheck/test. Commit: `feat(rewards): add redemption hold/resolve DB methods and wallet reads`.

---

## Task 4: `GiftCardVendor`, adapters wiring, three notification templates

**Files:**
- Create: `src/adapters/giftcards/types.ts`, `src/adapters/giftcards/manual.ts`, `src/adapters/giftcards/fake.ts`, `src/adapters/giftcards/giftcards.test.ts`
- Modify: `src/lib/adapters.impl.ts`, `src/modules/notifications/templates.ts`, `src/modules/notifications/templates.test.ts`

**Interfaces:**
- Produces:
```ts
// types.ts
export interface IssueGiftCardInput { redemptionId: string; brand: string; denominationPaise: number }
export interface IssueGiftCardResult { status: "pending" | "issued"; vendorRef: string | null }
export interface GiftCardVendor { readonly name: string; issue(input: IssueGiftCardInput): Promise<IssueGiftCardResult> }
```
`createManualFulfilmentVendor(): GiftCardVendor` (`name: "manual"`, always `{ status: "pending", vendorRef: null }`); `createFakeGiftCardVendor(): { vendor: GiftCardVendor; issued: IssueGiftCardInput[]; setResult(result: IssueGiftCardResult): void; setFailure(fail: boolean): void }` (`name: "fake"`; records calls; failure makes `issue` throw `Error("fake gift-card vendor failure")`). `Adapters.giftCards: GiftCardVendor` (manual in every environment for now; note in the factory's doc comment).
Templates (added to `templateNames` and `templates`): `reward.released` payload `{ requestId: string.min(1), tranche: z.union([z.literal(1), z.literal(2)]), points: int positive, companyName: string.min(1) }`; `redemption.fulfilled` payload `{ redemptionId, brand: string.min(1), points: int positive }`; `redemption.rejected` payload `{ redemptionId, points: int positive, reason: string.min(1) }`.

- [ ] **Step 1: Failing tests.** `giftcards.test.ts`: manual returns pending/null and name "manual"; fake records `issued`, `setResult({status:"issued", vendorRef:"V1"})` is returned, `setFailure(true)` makes `issue` reject. `templates.test.ts`: extend the "exactly the expected names" test to the 8 names; for each new template assert all four render functions + `whatsappTemplateName`; render tests with valid payloads (subject non-empty, email contains the points/brand, WhatsApp text contains points); an escaping test (`brand`/`reason`/`companyName` containing `<b>&"'` are escaped in the HTML body but raw in the WhatsApp text, subject stays plain text); a locked-vocabulary test that none of the three templates' email HTML/subject/WhatsApp text contains `refer`, `payout` (case-insensitive) and that `reward.released` mentions "Insider Rewards"; invalid payloads throw.
- [ ] **Step 2: RED; Step 3: implement.** Templates copy (use `escapeHtml` for interpolated strings in HTML only; subject plain):
  - `reward.released`: subject `You earned Insider Rewards points`; html `<p>Your vouch for a candidate at ${escapeHtml(companyName)} earned you ${points} points in Insider Rewards on ${brand.name} (tranche ${tranche}).</p>`; WhatsApp `You earned ${points} points in Insider Rewards for your vouch at ${companyName} on ${brand.name}.`; whatsappTemplateName `reward_released`, params `{ points: String(points), companyName }`.
  - `redemption.fulfilled`: subject `Your gift card redemption is fulfilled`; html `<p>Your redemption of ${points} points for a ${escapeHtml(brand)} gift card on ${brand.name} has been fulfilled.</p>` (name clash: the payload field `brand` vs the imported `brand` config — rename the destructured payload field to `giftCardBrand` locally); WhatsApp `Your redemption of ${points} points for a ${giftCardBrand} gift card was fulfilled.`; name `redemption_fulfilled`, params `{ points, brand }`.
  - `redemption.rejected`: subject `Your gift card redemption was not approved`; html `<p>Your redemption of ${points} points on ${brand.name} was not approved: ${escapeHtml(reason)}. The points are back in your wallet.</p>`; WhatsApp `Your redemption of ${points} points was not approved: ${reason}. The points are back in your wallet.`; name `redemption_rejected`, params `{ points, reason }`.
  Wire `giftCards: createManualFulfilmentVendor()` into `getAdapters` and the `Adapters` interface/doc comment.
- [ ] **Step 4: Verify and commit.** Commit: `feat(rewards): add GiftCardVendor with manual and fake implementations and reward notification templates`.

---

## Task 5: `rewards` module — release, wallet, redemption request

**Files:**
- Create: `src/modules/rewards/rewards.ts`, `src/modules/rewards/rewards.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4 (`computeTranchePoints`, `requireRewardsConfig`, `RewardsNotConfiguredError`, `Database.rewards.*`, `GiftCardVendor`, `notify`, templates, `getRulesWithVersion` from `../config/config`).
- Produces:
```ts
export interface RewardsDeps { db: Database; queue: QueueClient; giftCards: GiftCardVendor }
export class BelowMinimumRedemptionError extends Error   // (points: number, minimum: number)
export class UnknownBrandError extends Error             // (brand: string)
export async function notifyInsiderOrLog(deps: { db: Database; queue: QueueClient }, insiderProfileId: string, template: TemplateName, payload: unknown, eventKey: string): Promise<void>
export async function releaseTranche(deps: RewardsDeps, input: { requestId: string; tranche: 1 | 2 }): Promise<InsiderRewardRecord | null>
export async function getWallet(deps: { db: Database }, insiderProfileId: string): Promise<WalletSummary>
export async function listRewards(deps: { db: Database }, insiderProfileId: string): Promise<InsiderRewardRecord[]>
export async function listRedemptions(deps: { db: Database }, insiderProfileId: string): Promise<RewardRedemptionRecord[]>
export async function requestRedemption(deps: RewardsDeps, input: { idempotencyKey: string; insiderProfileId: string; points: number; brand: string }): Promise<RewardRedemptionRecord>
```
Behaviour: `releaseTranche` loads the request (`db.requests.getById`, throw if missing), rules via the request's `rulesVersion`, computes points, returns `null` when 0, else `db.rewards.releaseTranche` (idempotent) — it does NOT notify (tranche 1 is notified by `reviewProof`; tranche 2's caller will notify). `requestRedemption`: `requireRewardsConfig(latest rules)`; reject `!Number.isInteger(points) || points <= 0 || points < rules.minRedemptionPoints` with `BelowMinimumRedemptionError`; brand not in `giftCardBrands` → `UnknownBrandError`; `denominationPaise = points * paisePerPoint`; `db.rewards.createRedemption` with key `redemption:${insiderProfileId}:${idempotencyKey}` and `vendor: deps.giftCards.name`; if `created` is false → return the row WITHOUT calling the vendor; else call `giftCards.issue`; vendor throws → `console.error`, return the row still `pending`; result `pending` → return the row; result `issued` → `db.rewards.resolveRedemption({ redemptionId, outcome: "fulfilled", vendorRef })` then `notifyInsiderOrLog(..., "redemption.fulfilled", { redemptionId, brand, points }, \`redemption:${id}:fulfilled\`)`, return the resolved row. `InsufficientPointsError` from the DB propagates. `notifyInsiderOrLog` looks up `db.identity.getInsiderProfileById(...).userId`, calls `notify` in try/catch, logs and swallows any error (missing profile included).

- [ ] **Step 1: Failing tests** with fakes (`createFakeDatabase`, `createFakeQueueClient`/a send-recording spy queue, `createFakeGiftCardVendor`); seed `rules` version 1 via `seedConfig` with the Task 1 `BASE` values (includes the three new fields) and give the insider points via `db.rewards.releaseTranche`. Cover: `releaseTranche` computes with the request's stamped rules version (seed rules v1 and v2 with different `pointsPerCredit`; a request stamped v1 pays by v1) and returns `null` for 0 points; idempotent (second call same reward); missing request throws; wallet/list reads pass through; `requestRedemption` happy path (manual-style `pending` result → row `pending`, vendor called once with `denominationPaise = points × paisePerPoint`, wallet balance reduced, pending points up); below minimum; non-integer/zero/negative; unknown brand; insufficient points (`InsufficientPointsError`); replay of the same `idempotencyKey` returns the same row and does NOT call the vendor again and does not debit twice; vendor failure (`setFailure(true)`) → row stays `pending`, points still held, error logged, no throw; vendor `issued` → row `fulfilled` with `vendorRef`, escrow moved to platform, exactly one `notify.send` for `redemption.fulfilled` and a replay sends no second one; missing `pointsPerCredit`/`paisePerPoint`/`giftCardBrands` in rules → `RewardsNotConfiguredError` (no row, no debit).
- [ ] **Step 2: RED; Step 3: implement `rewards.ts`; Step 4: verify** (focused, then once lint/typecheck/test). Commit: `feat(rewards): add rewards module with tranche release, wallet and redemption requests`.

---

## Task 6: Admin redemption actions and `reviewProof` tranche-1 wiring

**Files:**
- Modify: `src/modules/admin/admin.ts`, `src/modules/admin/admin.test.ts`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces (admin.ts): `MissingVendorRefError`, `MissingRedemptionReasonError`; `listRedemptions(deps: { db: Database }, status?: RedemptionStatus): Promise<RewardRedemptionRecord[]>` (name it `listRewardRedemptions` in admin.ts to avoid clashing with the rewards module's per-insider `listRedemptions`); `fulfilRedemption(deps: AdminDeps, input: { adminUserId: string; redemptionId: string; vendorRef: string }): Promise<RewardRedemptionRecord>`; `rejectRedemption(deps: AdminDeps, input: { adminUserId: string; redemptionId: string; reason: string }): Promise<RewardRedemptionRecord>`. `reviewProof` (verify) now releases tranche 1.

Behaviour:
- `fulfilRedemption`: `vendorRef` non-empty (trimmed) else `MissingVendorRefError`; `db.rewards.resolveRedemption({ redemptionId, outcome: "fulfilled", vendorRef, adminAudit: { adminUserId, action: "redemption.fulfil", targetType: "reward_redemption", targetId: redemptionId, detail: vendorRef } })`; then `notifyInsiderOrLog(deps, row.insiderProfileId, "redemption.fulfilled", { redemptionId, brand: row.brand, points: row.points }, \`redemption:${redemptionId}:fulfilled\`)`; return the row. Replaying the same fulfil returns the row and (via notify dedupe) sends nothing new; fulfilling a rejected redemption throws `RedemptionAlreadyResolvedError`.
- `rejectRedemption`: `reason` non-empty else `MissingRedemptionReasonError`; audit action `redemption.reject`, detail = reason; notify `redemption.rejected` `{ redemptionId, points, reason }`, event key `redemption:${redemptionId}:rejected`.
- `reviewProof(verify)`: before `applyTransition`, load rules with `getRulesWithVersion(deps, record.rulesVersion)` (import from `../config/config`), `points = computeTranchePoints(rules, record.creditCost, 1)`; when `points > 0` pass `trancheRelease: { insiderProfileId: record.insiderProfileId, tranche: 1, points }` to `applyTransition` (keeps the existing `transitionKey` and audit). A `RewardsNotConfiguredError`/`ConfigNotFoundError` thrown while loading/computing propagates BEFORE any state change. After the commit, alongside the existing proof.verified notifications, `notifyOrLog` the Insider with `reward.released` `{ requestId, tranche: 1, points, companyName: insiderSummary.companyName }` using the same `transitionKey` as event key, only when `points > 0` and only inside the same try/independent-notify pattern already in the function. `reject` is unchanged.
- **Existing tests:** every existing `reviewProof(verify)` test now needs `rules` seeded in its fake DB (`seedConfig({ key: "rules", version: 1, placeholder: true, value: RULES_VALUE })` with `pointsPerCredit`, `paisePerPoint`, `giftCardBrands` included) and a request whose `rulesVersion` matches; update the shared setup helper accordingly and adjust any expected notification counts (verify now sends 3 notifications when points > 0: `proof.verified` to the Insider and to the Seeker, plus `reward.released` to the Insider).

- [ ] **Step 1: Failing tests** in `admin.test.ts`: verify releases tranche 1 (`getWallet` balance = `computeTranchePoints(...)`, one `insider_rewards` row, request `SUBMITTED`) atomically — and a verify with rules lacking `pointsPerCredit` throws `RewardsNotConfiguredError` and leaves the request `PROOF_PENDING`, no reward row, no audit row; replaying `reviewProof(verify)` (same `idempotencyKey`, stale-snapshot technique from the existing replay test) creates no second reward and no extra notification; verify sends `reward.released` to the Insider (assert via `db.notifications.getById` on the recorded ids: userId, template, payload.tranche, payload.points); a notify failure for `reward.released` does not fail the mutation; `tranche1Percent: 0` verifies without a reward row or `reward.released`. Redemptions: fulfil happy path (status, `vendorRef`, escrow→platform, audit row with action `redemption.fulfil`, notification to the right Insider user with template `redemption.fulfilled`); reject happy path (points restored, audit row `redemption.reject` with the reason, `redemption.rejected` notification); missing `vendorRef`/`reason` throw their errors and change nothing; replay sends no second notification; conflicting resolve → `RedemptionAlreadyResolvedError`; `listRewardRedemptions` filters by status and is newest-first; notification failure never fails fulfil/reject (queue that throws for `notify.send`).
- [ ] **Step 2: RED; Step 3: implement; Step 4: verify** (focused `admin.test.ts` and `requests.test.ts`, then once lint/typecheck/test). Commit: `feat(admin): release tranche 1 on proof verify and add redemption fulfil/reject`.

---

## Task 7: Live integration test (opt-in)

**Files:**
- Create: `src/modules/rewards/rewards.live.test.ts`

**Interfaces:**
- Consumes: real `Database` (`createRealDatabase(drizzle(new Pool(...)))`), migrations 0000–0011 applied to the dev DB, `pg` for one raw query.
- Produces: an opt-in (`RUN_VENDOR_TESTS=1`) suite proving the real adapter's rewards SQL.

- [ ] **Step 1: Write the test.** Same header as `src/modules/notifications/notifications.live.test.ts` (`// @vitest-environment node`, `describe.skipIf(process.env.RUN_VENDOR_TESTS !== "1")`, unique `tag`, `Pool` + `afterAll(pool.end)`). Fixtures against the real DB through `db.identity`/`db.ledger`/`db.requests` methods: a seeker profile with credits (grant via `db.ledger.postTxn` on `credits`), a verified insider profile at a seeded company (look up one company id with `pool.query("select id from companies limit 1")`; the dev DB is seeded by `npm run db:seed`), and requests created with `db.requests.sendRequest({... rulesVersion: 1 ...})` (read `sendRequest`'s real input type in `types.ts`). Tests:
  1. `releaseTranche` posts a zero-sum points txn, returns the row, balance = points; second call same `(requestId, tranche)` is idempotent (same id, balance unchanged); tranche 2 adds.
  2. `applyTransition` with `trancheRelease` (drive one request SENT→ACCEPTED→PROOF_PENDING via `accept` and `submitProof` db methods, then `verify`): state `SUBMITTED` and reward row and balance in one shot; replay of the same transition key returns without a second reward.
  3. `applyTransition` atomicity: call it with `trancheRelease.points` 0 → no reward row; call it with an invalid `fromState` → throws `RequestStateConflictError` and NO reward row / balance change.
  4. `createRedemption` debits/escrows correctly; replay with the same key returns `created: false`; `InsufficientPointsError` when over balance.
  5. **Overspend race:** with a balance of 100, `Promise.allSettled` two `createRedemption` calls of 60 points each with different keys → exactly one fulfilled and one rejected with `InsufficientPointsError`; final insider balance 40 and exactly one hold txn.
  6. `resolveRedemption` fulfilled: escrow → platform; status/vendorRef/resolvedAt persisted; audit row written when `adminAudit` given (query `admin_audit_log` via `pool`); rejected: balance restored and reason persisted; replay same outcome is a no-op; opposite outcome throws `RedemptionAlreadyResolvedError`.
  7. `getWallet` matches expectations; `listRedemptions` filters by status.
  8. Ledger invariant: `select sum(amount) from ledger_entries e join ledger_accounts a on a.id = e.account_id where a.currency = 'points'` over the insiders/escrows/platform created by this run nets to zero (scope the query to this run's accounts by `owner_id in (...)`; the platform account is shared, so assert the per-txn zero-sum instead: every `ledger_txns` whose key starts with `request:%:tranche:%` or `redemption:%` created by this run sums to 0).
- [ ] **Step 2: Run it live.** Dev Postgres up (`infra-postgres-1`; docker CLI at `C:\Users\dml-anmol\AppData\Local\Programs\DockerDesktop\resources\bin`), then in a subshell: `export $(grep -v '^#' .env.local | grep -v '^$' | xargs -d '\n'); npm run db:migrate; npm run db:seed; RUN_VENDOR_TESTS=1 npx vitest run src/modules/rewards/rewards.live.test.ts`. Expected: 0011 applied and all tests PASS; paste the real output. If a live test fails it is a REAL FINDING about `real.ts`: do NOT weaken the test; report BLOCKED with the output (the controller decides the fix).
- [ ] **Step 3: Default run** without `RUN_VENDOR_TESTS` (and without exporting `.env.local`): the file is skipped, `npm test` green.
- [ ] **Step 4: Verify and commit** once lint/typecheck/test. Commit: `test(rewards): add opt-in live Postgres integration test for rewards`.

---

## Post-tasks (controller)

- Re-run the older live test too (`RUN_VENDOR_TESTS=1 npx vitest run src/modules/notifications/notifications.live.test.ts`) — `applyTransition` and the DB layer changed.
- Final whole-branch review (opus) against the spec and AGENTS.md; fix Critical/Important in one wave; record deferred follow-ups in a "Final review findings and deferred follow-ups" section at the end of this plan.
- Update SESSION-HANDOFF.md (§0, §1, §2 table, §3, §5 item 3, next step: interview confirmation design or frontend), including the live-test command and any hard gates.
- `finishing-a-development-branch`: merge with a merge commit into `main`, re-run lint/typecheck/tests and the live tests on `main`, do not push, remove the worktree, delete the branch.
