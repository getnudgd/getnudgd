# Phase 1 Requests & Escrow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the already-built pure `requests/state.ts` state machine and `ledger` module to real persistence: a Seeker can send an Insider Request that debits their credits into escrow, and that request can be accepted, declined (refunding escrow), or expired (refunding escrow) — the `requests.sendRequest`/`accept`/`decline`/`expire` slice of AGENTS.md §3.11's Phase 1 backlog, which comes immediately after the already-merged `insiders`/`resumes` work.

**Architecture:** A new `Database.requests` adapter sub-interface exposes exactly three methods — `sendRequest`, `applyTransition`, `getById` — each of the first two performing its entire multi-table write (the `insider_requests` row, any `ledger_txns`/`ledger_entries` rows, and the append-only `request_events` row) as one atomic operation, per AGENTS.md §1.5's "every transition writes a `request_events` row and any ledger transaction in the same database transaction." The `requests` domain module (`src/modules/requests/requests.ts`) is the only caller of these adapter methods; it resolves business inputs (credit cost via the config module, current state via `getById`, the state machine's next state via the existing pure `state.ts`) and lets the adapter's single atomic call apply the change. This mirrors the `ledger.postTxn` pattern already proven in this codebase (idempotency-key lookup, `SELECT ... FOR UPDATE` on affected accounts, insert) rather than introducing a new generic transaction-wrapper abstraction.

**Tech Stack:** Drizzle ORM (`db.transaction(async (tx) => ...)`), Zod — both already in use, no additions.

**Spec:** `AGENTS.md` at the repo root — specifically §1.4 (data model: `insider_requests`, `request_events`), §1.5 (the state machine diagram and the same-transaction requirement), §3.2 (the `requests`/`ledger` module rows), §3.3 (ledger rules: idempotency, zero-sum, escrow accounts, `SELECT ... FOR UPDATE`), §3.7 (migrations). The pure state machine (`src/modules/requests/state.ts`) and the ledger module (`src/modules/ledger/ledger.ts`, `src/adapters/db/types.ts`'s `Database.ledger`) already exist from the merged Phase 0 plan and are consumed, not rebuilt, here. The `insiders` module (`src/modules/insiders/insiders.ts`) and `Database.identity.getInsiderProfileById` already exist from the merged Phase 1 Insiders & Resumes plan and are reused for the availability/verification gate and cost lookup.

## Global Constraints

- TypeScript strict, no `any`, no `@ts-ignore`; Zod at every boundary (AGENTS.md Part 2.1).
- Domain modules (`src/modules/requests`) import no Next.js, no Drizzle, no vendor SDK — only `Database` via a `deps` object (Part 2.2). They may import from sibling domain modules (`src/modules/insiders`, `src/modules/config`, `src/modules/ledger`) — this is already established practice (`insiders.ts` imports from `config`).
- Idempotency on every money-moving write (Part 2.4): every ledger-moving operation in this plan derives its idempotency key from the triggering event, following the exact `request:{id}:{event}` pattern AGENTS.md §3.4's jobs table already names for `request.expire`.
- Append-only tables are append-only (Part 2.5): `request_events` is only ever `INSERT`ed into by this plan's code, never `UPDATE`d or `DELETE`d.
- Business numbers are configuration, never code (§0.5): credit cost per tier and refund percentages are read through the `config` module's `getRules`/`getRulesWithVersion`, never hardcoded.
- All ledger writes run inside a transaction that first takes `SELECT ... FOR UPDATE` on the affected accounts (§3.3) — this plan's adapter methods follow the exact locking pattern already proven in `Database.ledger.postTxn`'s `real.ts` implementation.
- Small, verified commits with `type(scope): summary` commit messages; run `npm run lint && npm run typecheck && npm test` before every commit (Part 2.10).
- Do not add dependencies (Part 2.11) — this plan adds none.
- Locked vocabulary: Insider, Seeker, Insider Request, vouch, credits, points — never "referrer"/"referral request" (§0.4).
- No Postgres/Docker is available in this environment — `real.ts` additions must typecheck but cannot be executed against a live database here; this is expected, matching every prior plan in this project.

## Scope note

This plan covers `sendRequest`, `accept`, `decline`, `expire` only — the exact first chunk of AGENTS.md §3.11's Phase 1 ordering ("`requests.sendRequest` with escrow → accept/decline/expire"). It deliberately does **not** cover: `proof`/`reject`/`verify` (admin verification flow — needs an admin module and a `verification_proofs` table, a separate plan), `interview`/`complete`/`windowExpiry`/`close` (interview confirmation — a separate plan), pg-boss timers that actually *call* `expire` on a schedule (§3.4's `request.expire`/`requests.sweep` jobs — the "timers" backlog item, needs the pg-boss worker entry point wired to real job definitions, a separate plan), email notifications, `rewards`, and Playwright flows. `expire` is built here as a plain, idempotent module function ready for a future timer job to call — it does not schedule itself. Weekly Insider request-capacity limits (`insiderProfiles.weeklyLimit`) are also deliberately not enforced here: AGENTS.md's own `insider.weeklyReset` cron job (§3.4) is what makes a live weekly counter meaningful, and that job doesn't exist yet — enforcing a limit without a reset mechanism would either be permanently wrong or require inventing a counter-reset scheme ahead of its own plan. This was flagged as a known future dependency in the previous plan's self-review and is carried forward here, still deferred, to the same future timers/jobs plan.

---

## Task 1: Drizzle schema — insider_requests, request_events

**Files:**
- Modify: `drizzle/schema.ts`
- Create: `drizzle/migrations/0004_requests.sql` (generated, then renamed)

**Interfaces:**
- Produces: `insiderRequests`, `requestEvents` Drizzle table objects — consumed by Task 2's `real.ts` additions.

- [ ] **Step 1: Add the tables to `drizzle/schema.ts`**

Append (after `resumes`, the last table from the merged Phase 1 Insiders & Resumes plan):
```ts
export const insiderRequests = pgTable(
  "insider_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seekerProfileId: uuid("seeker_profile_id").notNull().references(() => seekerProfiles.id),
    insiderProfileId: uuid("insider_profile_id").notNull().references(() => insiderProfiles.id),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    state: text("state").notNull(),
    creditCost: integer("credit_cost").notNull(),
    rulesVersion: integer("rules_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    stateCheck: check(
      "insider_requests_state_check",
      sql`${table.state} in ('SENT','ACCEPTED','DECLINED','EXPIRED','CANCELLED','PROOF_PENDING','SUBMITTED','INTERVIEW','COMPLETE','NO_INTERVIEW','CLOSED')`
    ),
  })
);

export const requestEvents = pgTable(
  "request_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id").notNull().references(() => insiderRequests.id),
    idempotencyKey: text("idempotency_key").notNull(),
    event: text("event").notNull(),
    fromState: text("from_state"),
    toState: text("to_state").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    idempotencyKeyIdx: uniqueIndex("request_events_idempotency_key_idx").on(table.idempotencyKey),
  })
);
```
(All the imports this needs — `pgTable`, `uuid`, `text`, `integer`, `timestamp`, `uniqueIndex`, `check`, `sql` — are already imported at the top of `drizzle/schema.ts` from prior tasks; no import changes needed. `fromState` is intentionally nullable — the request's creation event, written by `sendRequest` in Task 2, has no prior state to record.)

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a new file under `drizzle/migrations/`. Rename it to `drizzle/migrations/0004_requests.sql` and update `drizzle/migrations/meta/_journal.json` to register it as the fifth entry (`idx: 4`), following the exact pattern used for `0000_init`/`0001_ledger_integrity`/`0002_identity`/`0003_resumes` — keep the auto-generated `when` timestamp and `breakpoints: true`, only correct `tag` to `"0004_requests"` and `idx` to `4`. Do not hand-edit the generated SQL or the auto-generated `meta/0004_snapshot.json`.

- [ ] **Step 3: Verify**

Run: `npm run typecheck` — must pass. Migration application against a live database is out of scope (no Postgres available), matching every prior plan.

- [ ] **Step 4: Commit**

```bash
git add drizzle/schema.ts drizzle/migrations
git commit -m "feat(db): add insider_requests and request_events schema"
```

Report status `DONE_WITH_CONCERNS`: the migration hasn't been applied to a live database.

---

## Task 2: Database.requests sub-interface

**Files:**
- Modify: `src/adapters/db/types.ts`
- Modify: `src/adapters/db/fake.ts`
- Modify: `src/adapters/db/fake.test.ts`
- Modify: `src/adapters/db/real.ts`

**Interfaces:**
- Consumes: `insiderRequests`, `requestEvents` tables from `drizzle/schema.ts` (Task 1); the existing `Database.ledger` account/entry machinery already proven in `postTxn`.
- Produces: `InsiderRequestRecord`, `RequestEventRecord` types, `InsufficientBalanceError`, `RequestStateConflictError` error classes, and a `Database.requests` sub-interface with `sendRequest`, `applyTransition`, `getById` — consumed by Task 3's `requests` module.

This is the only task that performs multi-table atomic writes. Both `sendRequest` and `applyTransition` follow the same shape: (1) an idempotency-key lookup against `request_events` that returns the current request unchanged if this exact event was already applied; (2) the actual state-and-ledger mutation; (3) an append to `request_events`. `sendRequest`'s idempotency key identifies the whole "create" attempt (so a caller can safely retry a network timeout without double-charging); `applyTransition`'s idempotency key is always `request:{requestId}:{event}` — since a `SENT` request can only be meaningfully accepted, declined, or expired once, this natural key is sufficient (no extra nonce needed), exactly matching the shape AGENTS.md §3.4 already names for `request.expire`.

- [ ] **Step 1: Add types to `src/adapters/db/types.ts`**

Append:
```ts
export interface InsiderRequestRecord {
  id: string;
  seekerProfileId: string;
  insiderProfileId: string;
  companyId: string;
  state: string;
  creditCost: number;
  rulesVersion: number;
  createdAt: Date;
}

export interface RequestEventRecord {
  id: string;
  requestId: string;
  idempotencyKey: string;
  event: string;
  fromState: string | null;
  toState: string;
  createdAt: Date;
}

export interface SendInsiderRequestInput {
  idempotencyKey: string;
  seekerProfileId: string;
  insiderProfileId: string;
  companyId: string;
  creditCost: number;
  rulesVersion: number;
}

export interface ApplyRequestTransitionInput {
  idempotencyKey: string;
  requestId: string;
  event: string;
  fromState: string;
  toState: string;
  ledgerEntries: PostLedgerEntryInput[];
  ledgerEventType: string;
}

export class InsufficientBalanceError extends Error {
  constructor(ownerType: LedgerOwnerType, ownerId: string, currency: LedgerCurrency, required: number, available: number) {
    super(`Insufficient ${currency} balance for ${ownerType}:${ownerId} (need ${required}, have ${available})`);
    this.name = "InsufficientBalanceError";
  }
}

export class RequestStateConflictError extends Error {
  constructor(requestId: string, expectedState: string, actualState: string) {
    super(`Request ${requestId} expected state "${expectedState}" but was "${actualState}"`);
    this.name = "RequestStateConflictError";
  }
}
```
(`PostLedgerEntryInput`, `LedgerOwnerType`, `LedgerCurrency` are already defined earlier in this same file — no new imports needed for this step.)

Add this key to the `Database` interface, alongside `ledger`/`config`/`identity`/`resumes`/`insiders`:
```ts
  requests: {
    sendRequest(input: SendInsiderRequestInput): Promise<InsiderRequestRecord>;
    applyTransition(input: ApplyRequestTransitionInput): Promise<InsiderRequestRecord>;
    getById(requestId: string): Promise<InsiderRequestRecord | null>;
  };
```

- [ ] **Step 2: Write the failing tests**

Add a new `describe` block to `src/adapters/db/fake.test.ts`:
```ts
describe("createFakeDatabase requests", () => {
  async function seedSeekerWithCredits(db: ReturnType<typeof createFakeDatabase>["db"], amount: number): Promise<string> {
    const user = await db.identity.findOrCreateUser(`fb-req-${amount}-${Math.random()}`, `req${amount}@seeker.com`, "seeker");
    const profile = await db.identity.createSeekerProfile(user.id, "Test Seeker");
    if (amount > 0) {
      await db.ledger.postTxn({
        idempotencyKey: `grant:${profile.id}:${amount}`,
        eventType: "credits.grant",
        entries: [
          { ownerType: "platform", ownerId: "platform", currency: "credits", amount: -amount },
          { ownerType: "seeker", ownerId: profile.id, currency: "credits", amount },
        ],
      });
    }
    return profile.id;
  }

  it("creates a SENT request and moves credits from seeker to escrow", async () => {
    const { db } = createFakeDatabase();
    const seekerProfileId = await seedSeekerWithCredits(db, 5);

    const request = await db.requests.sendRequest({
      idempotencyKey: "send:1",
      seekerProfileId,
      insiderProfileId: "insider-1",
      companyId: "company-1",
      creditCost: 3,
      rulesVersion: 1,
    });

    expect(request.state).toBe("SENT");
    expect(await db.ledger.getBalance("seeker", seekerProfileId, "credits")).toBe(2);
    expect(await db.ledger.getBalance("escrow", request.id, "credits")).toBe(3);
  });

  it("is idempotent: calling sendRequest twice with the same idempotencyKey returns the same request and does not double-charge", async () => {
    const { db } = createFakeDatabase();
    const seekerProfileId = await seedSeekerWithCredits(db, 5);

    const first = await db.requests.sendRequest({
      idempotencyKey: "send:2",
      seekerProfileId,
      insiderProfileId: "insider-1",
      companyId: "company-1",
      creditCost: 3,
      rulesVersion: 1,
    });
    const second = await db.requests.sendRequest({
      idempotencyKey: "send:2",
      seekerProfileId,
      insiderProfileId: "insider-1",
      companyId: "company-1",
      creditCost: 3,
      rulesVersion: 1,
    });

    expect(second.id).toBe(first.id);
    expect(await db.ledger.getBalance("seeker", seekerProfileId, "credits")).toBe(2);
  });

  it("throws InsufficientBalanceError when the seeker cannot cover the cost", async () => {
    const { db } = createFakeDatabase();
    const seekerProfileId = await seedSeekerWithCredits(db, 1);

    await expect(
      db.requests.sendRequest({
        idempotencyKey: "send:3",
        seekerProfileId,
        insiderProfileId: "insider-1",
        companyId: "company-1",
        creditCost: 3,
        rulesVersion: 1,
      })
    ).rejects.toThrow(InsufficientBalanceError);
  });

  it("getById returns null for an unknown request", async () => {
    const { db } = createFakeDatabase();
    expect(await db.requests.getById("nope")).toBeNull();
  });

  it("applyTransition moves a SENT request to ACCEPTED with no ledger movement", async () => {
    const { db } = createFakeDatabase();
    const seekerProfileId = await seedSeekerWithCredits(db, 5);
    const request = await db.requests.sendRequest({
      idempotencyKey: "send:4",
      seekerProfileId,
      insiderProfileId: "insider-1",
      companyId: "company-1",
      creditCost: 3,
      rulesVersion: 1,
    });

    const updated = await db.requests.applyTransition({
      idempotencyKey: `request:${request.id}:accept`,
      requestId: request.id,
      event: "accept",
      fromState: "SENT",
      toState: "ACCEPTED",
      ledgerEntries: [],
      ledgerEventType: "request.accept",
    });

    expect(updated.state).toBe("ACCEPTED");
    expect(await db.ledger.getBalance("escrow", request.id, "credits")).toBe(3);
  });

  it("applyTransition refunds escrow to the seeker on decline", async () => {
    const { db } = createFakeDatabase();
    const seekerProfileId = await seedSeekerWithCredits(db, 5);
    const request = await db.requests.sendRequest({
      idempotencyKey: "send:5",
      seekerProfileId,
      insiderProfileId: "insider-1",
      companyId: "company-1",
      creditCost: 3,
      rulesVersion: 1,
    });

    await db.requests.applyTransition({
      idempotencyKey: `request:${request.id}:decline`,
      requestId: request.id,
      event: "decline",
      fromState: "SENT",
      toState: "DECLINED",
      ledgerEntries: [
        { ownerType: "escrow", ownerId: request.id, currency: "credits", amount: -3 },
        { ownerType: "seeker", ownerId: seekerProfileId, currency: "credits", amount: 3 },
      ],
      ledgerEventType: "request.decline",
    });

    expect(await db.ledger.getBalance("escrow", request.id, "credits")).toBe(0);
    expect(await db.ledger.getBalance("seeker", seekerProfileId, "credits")).toBe(5);
  });

  it("applyTransition is idempotent: reapplying the same idempotencyKey does not re-refund", async () => {
    const { db } = createFakeDatabase();
    const seekerProfileId = await seedSeekerWithCredits(db, 5);
    const request = await db.requests.sendRequest({
      idempotencyKey: "send:6",
      seekerProfileId,
      insiderProfileId: "insider-1",
      companyId: "company-1",
      creditCost: 3,
      rulesVersion: 1,
    });
    const transitionInput = {
      idempotencyKey: `request:${request.id}:decline`,
      requestId: request.id,
      event: "decline",
      fromState: "SENT",
      toState: "DECLINED",
      ledgerEntries: [
        { ownerType: "escrow" as const, ownerId: request.id, currency: "credits" as const, amount: -3 },
        { ownerType: "seeker" as const, ownerId: seekerProfileId, currency: "credits" as const, amount: 3 },
      ],
      ledgerEventType: "request.decline",
    };

    await db.requests.applyTransition(transitionInput);
    await db.requests.applyTransition(transitionInput);

    expect(await db.ledger.getBalance("seeker", seekerProfileId, "credits")).toBe(5);
  });

  it("applyTransition throws RequestStateConflictError when fromState doesn't match the current state", async () => {
    const { db } = createFakeDatabase();
    const seekerProfileId = await seedSeekerWithCredits(db, 5);
    const request = await db.requests.sendRequest({
      idempotencyKey: "send:7",
      seekerProfileId,
      insiderProfileId: "insider-1",
      companyId: "company-1",
      creditCost: 3,
      rulesVersion: 1,
    });
    await db.requests.applyTransition({
      idempotencyKey: `request:${request.id}:accept`,
      requestId: request.id,
      event: "accept",
      fromState: "SENT",
      toState: "ACCEPTED",
      ledgerEntries: [],
      ledgerEventType: "request.accept",
    });

    await expect(
      db.requests.applyTransition({
        idempotencyKey: `request:${request.id}:decline`,
        requestId: request.id,
        event: "decline",
        fromState: "SENT",
        toState: "DECLINED",
        ledgerEntries: [],
        ledgerEventType: "request.decline",
      })
    ).rejects.toThrow(RequestStateConflictError);
  });
});
```
`fake.test.ts` already has this import line: `import { LedgerImbalanceError } from "./types";`. Change it to:
```ts
import { LedgerImbalanceError, InsufficientBalanceError, RequestStateConflictError } from "./types";
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/adapters/db/fake.test.ts`
Expected: FAIL — `db.requests` doesn't exist yet.

- [ ] **Step 4: Implement in `src/adapters/db/fake.ts`**

Add two new in-memory arrays alongside the existing ones (`accounts`, `txns`, `resumeRows`, etc.):
```ts
  const insiderRequestRows: InsiderRequestRecord[] = [];
  const requestEventRows: RequestEventRecord[] = [];
```

Add `InsiderRequestRecord`, `RequestEventRecord`, `InsufficientBalanceError`, `RequestStateConflictError` to the existing import from `./types`.

Add this key to the returned `db` object, alongside `ledger`/`config`/`identity`/`resumes`/`insiders`:
```ts
    requests: {
      async sendRequest(input) {
        const existingEvent = requestEventRows.find((e) => e.idempotencyKey === input.idempotencyKey);
        if (existingEvent) {
          const existing = insiderRequestRows.find((r) => r.id === existingEvent.requestId);
          if (existing) return existing;
        }

        const seekerAccount = accounts.find(
          (a) => a.ownerType === "seeker" && a.ownerId === input.seekerProfileId && a.currency === "credits"
        );
        const balance = seekerAccount
          ? txns
              .flatMap((t) => t.entries)
              .filter((e) => e.accountId === seekerAccount.id)
              .reduce((sum, e) => sum + e.amount, 0)
          : 0;
        if (balance < input.creditCost) {
          throw new InsufficientBalanceError("seeker", input.seekerProfileId, "credits", input.creditCost, balance);
        }

        const requestId = genId();
        const record: InsiderRequestRecord = {
          id: requestId,
          seekerProfileId: input.seekerProfileId,
          insiderProfileId: input.insiderProfileId,
          companyId: input.companyId,
          state: "SENT",
          creditCost: input.creditCost,
          rulesVersion: input.rulesVersion,
          createdAt: new Date(),
        };
        insiderRequestRows.push(record);

        const seekerAcc = findOrCreateAccount("seeker", input.seekerProfileId, "credits");
        const escrowAcc = findOrCreateAccount("escrow", requestId, "credits");
        const txnId = genId();
        txns.push({
          id: txnId,
          idempotencyKey: `${input.idempotencyKey}:ledger`,
          eventType: "request.send",
          createdAt: new Date(),
          entries: [
            { id: genId(), txnId, accountId: seekerAcc.id, currency: "credits", amount: -input.creditCost },
            { id: genId(), txnId, accountId: escrowAcc.id, currency: "credits", amount: input.creditCost },
          ],
        });

        requestEventRows.push({
          id: genId(),
          requestId,
          idempotencyKey: input.idempotencyKey,
          event: "send",
          fromState: null,
          toState: "SENT",
          createdAt: new Date(),
        });

        return record;
      },
      async applyTransition(input) {
        const existingEvent = requestEventRows.find((e) => e.idempotencyKey === input.idempotencyKey);
        if (existingEvent) {
          const current = insiderRequestRows.find((r) => r.id === input.requestId);
          if (current) return current;
        }

        const current = insiderRequestRows.find((r) => r.id === input.requestId);
        if (!current) throw new Error(`Insider request ${input.requestId} not found`);
        if (current.state !== input.fromState) {
          throw new RequestStateConflictError(input.requestId, input.fromState, current.state);
        }

        current.state = input.toState;

        if (input.ledgerEntries.length > 0) {
          assertZeroSum(input.ledgerEntries);
          const txnId = genId();
          const entries = input.ledgerEntries.map((e) => {
            const account = findOrCreateAccount(e.ownerType, e.ownerId, e.currency);
            return { id: genId(), txnId, accountId: account.id, currency: e.currency, amount: e.amount };
          });
          txns.push({
            id: txnId,
            idempotencyKey: `${input.idempotencyKey}:ledger`,
            eventType: input.ledgerEventType,
            createdAt: new Date(),
            entries,
          });
        }

        requestEventRows.push({
          id: genId(),
          requestId: input.requestId,
          idempotencyKey: input.idempotencyKey,
          event: input.event,
          fromState: input.fromState,
          toState: input.toState,
          createdAt: new Date(),
        });

        return current;
      },
      async getById(requestId) {
        return insiderRequestRows.find((r) => r.id === requestId) ?? null;
      },
    },
```
(This reuses the file's existing local `genId`, `findOrCreateAccount`, `assertZeroSum`, `accounts`, `txns` — all already defined in this file from the Phase 0 `ledger` work. No new local helpers needed.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/adapters/db/fake.test.ts`
Expected: PASS (9 new tests).

- [ ] **Step 6: Implement in `src/adapters/db/real.ts`**

Add `insiderRequests, requestEvents` to the existing schema import line. Add `InsiderRequestRecord`, `SendInsiderRequestInput`, `ApplyRequestTransitionInput` to the existing type imports from `./types` — do NOT also import `PostLedgerEntryInput` here, since it is never referenced by name in `real.ts` (its fields are always accessed through `input.ledgerEntries`/`entry.*`, never through an explicit standalone type annotation); adding it would produce an unused-import lint warning. Add `InsufficientBalanceError`, `RequestStateConflictError` to the existing import of error classes from `./types` (alongside `LedgerImbalanceError`).

Add this key to the returned object, alongside `ledger`/`config`/`identity`/`resumes`/`insiders`:
```ts
    requests: {
      async sendRequest(input) {
        return db.transaction(async (tx) => {
          const [existingEvent] = await tx
            .select()
            .from(requestEvents)
            .where(eq(requestEvents.idempotencyKey, input.idempotencyKey));
          if (existingEvent) {
            const [existing] = await tx.select().from(insiderRequests).where(eq(insiderRequests.id, existingEvent.requestId));
            if (existing) return existing as InsiderRequestRecord;
          }

          let [seekerAccount] = await tx
            .select()
            .from(ledgerAccounts)
            .where(
              and(
                eq(ledgerAccounts.ownerType, "seeker"),
                eq(ledgerAccounts.ownerId, input.seekerProfileId),
                eq(ledgerAccounts.currency, "credits")
              )
            )
            .for("update");

          let balance = 0;
          if (seekerAccount) {
            const [row] = await tx
              .select({ total: sum(ledgerEntries.amount) })
              .from(ledgerEntries)
              .where(eq(ledgerEntries.accountId, seekerAccount.id));
            balance = Number(row?.total ?? 0);
          }
          if (balance < input.creditCost) {
            throw new InsufficientBalanceError("seeker", input.seekerProfileId, "credits", input.creditCost, balance);
          }

          if (!seekerAccount) {
            [seekerAccount] = await tx
              .insert(ledgerAccounts)
              .values({ ownerType: "seeker", ownerId: input.seekerProfileId, currency: "credits" })
              .returning();
          }

          const [requestRow] = await tx
            .insert(insiderRequests)
            .values({
              seekerProfileId: input.seekerProfileId,
              insiderProfileId: input.insiderProfileId,
              companyId: input.companyId,
              state: "SENT",
              creditCost: input.creditCost,
              rulesVersion: input.rulesVersion,
            })
            .returning();

          const [escrowAccount] = await tx
            .insert(ledgerAccounts)
            .values({ ownerType: "escrow", ownerId: requestRow.id, currency: "credits" })
            .returning();

          const [txnRow] = await tx
            .insert(ledgerTxns)
            .values({ idempotencyKey: `${input.idempotencyKey}:ledger`, eventType: "request.send" })
            .returning();

          await tx.insert(ledgerEntries).values([
            { txnId: txnRow.id, accountId: seekerAccount.id, currency: "credits", amount: -input.creditCost },
            { txnId: txnRow.id, accountId: escrowAccount.id, currency: "credits", amount: input.creditCost },
          ]);

          await tx.insert(requestEvents).values({
            requestId: requestRow.id,
            idempotencyKey: input.idempotencyKey,
            event: "send",
            fromState: null,
            toState: "SENT",
          });

          return requestRow as InsiderRequestRecord;
        });
      },
      async applyTransition(input) {
        return db.transaction(async (tx) => {
          const [existingEvent] = await tx
            .select()
            .from(requestEvents)
            .where(eq(requestEvents.idempotencyKey, input.idempotencyKey));
          if (existingEvent) {
            const [current] = await tx.select().from(insiderRequests).where(eq(insiderRequests.id, input.requestId));
            if (current) return current as InsiderRequestRecord;
          }

          const [current] = await tx
            .select()
            .from(insiderRequests)
            .where(eq(insiderRequests.id, input.requestId))
            .for("update");
          if (!current) throw new Error(`Insider request ${input.requestId} not found`);
          if (current.state !== input.fromState) {
            throw new RequestStateConflictError(input.requestId, input.fromState, current.state);
          }

          const [updated] = await tx
            .update(insiderRequests)
            .set({ state: input.toState })
            .where(eq(insiderRequests.id, input.requestId))
            .returning();

          if (input.ledgerEntries.length > 0) {
            const [txnRow] = await tx
              .insert(ledgerTxns)
              .values({ idempotencyKey: `${input.idempotencyKey}:ledger`, eventType: input.ledgerEventType })
              .returning();

            for (const entry of input.ledgerEntries) {
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
              await tx
                .insert(ledgerEntries)
                .values({ txnId: txnRow.id, accountId: account.id, currency: entry.currency, amount: entry.amount });
            }
          }

          await tx.insert(requestEvents).values({
            requestId: input.requestId,
            idempotencyKey: input.idempotencyKey,
            event: input.event,
            fromState: input.fromState,
            toState: input.toState,
          });

          return updated as InsiderRequestRecord;
        });
      },
      async getById(requestId) {
        const [row] = await db.select().from(insiderRequests).where(eq(insiderRequests.id, requestId));
        return (row as InsiderRequestRecord) ?? null;
      },
    },
```
(This mirrors `Database.ledger.postTxn`'s already-proven `SELECT ... FOR UPDATE` pattern exactly — read that method in this same file for a working reference if anything is unclear. Zero-sum validation of `input.ledgerEntries` is intentionally NOT re-checked in `real.ts`'s `applyTransition`, unlike the fake — `postTxn`'s own `real.ts` implementation also does not re-validate zero-sum in JS, relying on the caller (this plan's `requests` module, Task 3) to only ever pass balanced entries; this matches existing precedent in this file rather than introducing a new validation step.)

- [ ] **Step 7: Verify**

Run: `npm run typecheck` — must pass. `real.ts`'s Drizzle transaction typing can be sensitive to exact query-builder chaining; if something doesn't typecheck exactly as written, adjust minimally while preserving the transaction boundary, the `SELECT ... FOR UPDATE` locking, and the idempotency-key-first-check order — do not remove any of those three properties to make typecheck pass.
Run: `npm test` — full suite passes.

- [ ] **Step 8: Commit**

```bash
git add src/adapters/db
git commit -m "feat(adapters): extend Database with a requests sub-interface"
```

Report status `DONE_WITH_CONCERNS`: `real.ts`'s requests methods have not been exercised against a live Postgres instance.

---

## Task 3: src/modules/requests — sendRequest, accept, decline, expire

**Files:**
- Modify: `src/modules/ledger/ledger.ts`
- Modify: `src/modules/ledger/ledger.test.ts`
- Modify: `src/modules/config/config.ts`
- Modify: `src/modules/config/config.test.ts`
- Create: `src/modules/requests/requests.ts`
- Create: `src/modules/requests/requests.test.ts`

**Interfaces:**
- Consumes: `Database.requests` (Task 2); `Database.identity.getInsiderProfileById` and `Database` generally (already on main); `getInsider` from `src/modules/insiders/insiders.ts` (already on main); `nextState`, `RequestState`, `RequestEvent`, `InvalidTransitionError` from `src/modules/requests/state.ts` (already on main, from Phase 0); `escrowFor` from `src/modules/ledger/ledger.ts` (already on main).
- Produces: `platformAccount()` (added to `ledger.ts`), `getRulesWithVersion()` (added to `config.ts`), and the `requests` module's public interface: `sendRequest`, `accept`, `decline`, `expire`, plus `InsiderUnavailableError`.

- [ ] **Step 1: Write the failing test for `platformAccount()`**

`src/modules/ledger/ledger.test.ts` currently starts with:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createFakeDatabase } from "../../adapters/db/fake";
import { post, balance, escrowFor, type LedgerDeps } from "./ledger";
import { LedgerImbalanceError } from "../../adapters/db/types";
```
Change the third line to:
```ts
import { post, balance, escrowFor, platformAccount, type LedgerDeps } from "./ledger";
```
Then add this new top-level `describe` block anywhere after the existing `describe("ledger.post", ...)` block closes (the existing `escrowFor` test lives as a single `it(...)` inside that same `describe("ledger.post", ...)` block at line 75-77 — leave it untouched; this is a new, separate block, not a sibling inside it):
```ts
describe("platformAccount", () => {
  it("returns the fixed platform owner reference", () => {
    expect(platformAccount()).toEqual({ ownerType: "platform", ownerId: "platform" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/ledger/ledger.test.ts`
Expected: FAIL — `platformAccount` is not exported yet.

- [ ] **Step 3: Implement `platformAccount()` in `src/modules/ledger/ledger.ts`**

Add, right after the existing `escrowFor` function:
```ts
export function platformAccount(): { ownerType: "platform"; ownerId: "platform" } {
  return { ownerType: "platform", ownerId: "platform" };
}
```
(There is exactly one platform ledger account per currency in this system — `"platform"` is a fixed singleton owner id, the same design already used for `escrowFor`'s per-request singleton owner id.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/ledger/ledger.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for `getRulesWithVersion()`**

Add to `src/modules/config/config.test.ts` (reuse whatever seeding helper this file already uses to seed a `"rules"` config row — likely a call to `seedConfig` from `createFakeDatabase()`, following the same pattern as the existing `getRules` tests in this same file):
```ts
describe("getRulesWithVersion", () => {
  it("returns both the parsed rules and the version they came from", async () => {
    const { db, seedConfig } = createFakeDatabase();
    seedConfig({
      key: "rules",
      version: 3,
      placeholder: true,
      value: {
        responseWindowHours: 48,
        interviewWindowDays: 14,
        reverificationDays: 90,
        tranche1Percent: 50,
        tranche2Percent: 50,
        refundPercentOnDecline: 100,
        refundPercentOnExpiry: 100,
        minRedemptionPoints: 500,
        panThresholdPoints: 5000,
        freeCreditGrant: 3,
        requestCostByTier: { tier1: 3, tier2: 2, tier3: 1 },
      },
    });

    const result = await getRulesWithVersion({ db });
    expect(result.version).toBe(3);
    expect(result.rules.requestCostByTier.tier1).toBe(3);
  });

  it("throws ConfigNotFoundError when no rules exist", async () => {
    const { db } = createFakeDatabase();
    await expect(getRulesWithVersion({ db })).rejects.toThrow(ConfigNotFoundError);
  });
});
```
`src/modules/config/config.test.ts` currently starts with:
```ts
import { describe, it, expect } from "vitest";
import { createFakeDatabase } from "../../adapters/db/fake";
import { getRules, getPacks, ConfigNotFoundError } from "./config";
```
Change the third line to:
```ts
import { getRules, getPacks, getRulesWithVersion, ConfigNotFoundError } from "./config";
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/modules/config/config.test.ts`
Expected: FAIL — `getRulesWithVersion` is not exported yet.

- [ ] **Step 7: Implement `getRulesWithVersion()` in `src/modules/config/config.ts`**

Add this type export near the top (after the existing imports) and the function after the existing `getRules`:
```ts
export interface RulesWithVersion {
  rules: Rules;
  version: number;
}

export async function getRulesWithVersion(deps: ConfigDeps, version?: number): Promise<RulesWithVersion> {
  const row = version ? await deps.db.config.getVersion("rules", version) : await deps.db.config.getLatest("rules");
  if (!row) throw new ConfigNotFoundError("rules", version);
  return { rules: rulesSchema.parse(row.value), version: row.version };
}
```
(This does not change or duplicate `getRules` — both functions coexist, `getRulesWithVersion` is used only where the caller needs to stamp a `rules_version`, as `sendRequest` does in Step 11.)

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run src/modules/config/config.test.ts`
Expected: PASS.

- [ ] **Step 9: Write the failing tests for the `requests` module**

Create `src/modules/requests/requests.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createFakeDatabase } from "../../adapters/db/fake";
import { InvalidTransitionError } from "./state";
import { sendRequest, accept, decline, expire, InsiderUnavailableError, type RequestsDeps } from "./requests";

const RULES_VALUE = {
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
};

async function makeVerifiedInsiderAndFundedSeeker(
  creditGrant = 5
): Promise<{ deps: RequestsDeps; seekerProfileId: string; insiderProfileId: string }> {
  const { db, seedConfig, seedCompany } = createFakeDatabase();
  seedConfig({ key: "rules", version: 1, placeholder: true, value: RULES_VALUE });
  const company = seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);

  const seekerUser = await db.identity.findOrCreateUser("fb-seeker-1", "seeker1@x.com", "seeker");
  const seekerProfile = await db.identity.createSeekerProfile(seekerUser.id, "Seeker One");
  if (creditGrant > 0) {
    await db.ledger.postTxn({
      idempotencyKey: `grant:${seekerProfile.id}`,
      eventType: "credits.grant",
      entries: [
        { ownerType: "platform", ownerId: "platform", currency: "credits", amount: -creditGrant },
        { ownerType: "seeker", ownerId: seekerProfile.id, currency: "credits", amount: creditGrant },
      ],
    });
  }

  const insiderUser = await db.identity.findOrCreateUser("fb-insider-1", "insider1@acme.com", "seeker");
  const insiderProfile = await db.identity.findOrCreateInsiderProfile(insiderUser.id, company.id, "insider1@acme.com");
  await db.identity.markInsiderVerified(insiderProfile.id, new Date());

  return { deps: { db }, seekerProfileId: seekerProfile.id, insiderProfileId: insiderProfile.id };
}

describe("sendRequest", () => {
  it("debits the seeker and escrows the insider's tier1 cost", async () => {
    const { deps, seekerProfileId, insiderProfileId } = await makeVerifiedInsiderAndFundedSeeker(5);
    const request = await sendRequest(deps, { idempotencyKey: "k1", seekerProfileId, insiderProfileId });
    expect(request.state).toBe("SENT");
    expect(request.creditCost).toBe(3);
    expect(await deps.db.ledger.getBalance("seeker", seekerProfileId, "credits")).toBe(2);
  });

  it("stamps the rules_version the request was created under", async () => {
    const { deps, seekerProfileId, insiderProfileId } = await makeVerifiedInsiderAndFundedSeeker(5);
    const request = await sendRequest(deps, { idempotencyKey: "k2", seekerProfileId, insiderProfileId });
    expect(request.rulesVersion).toBe(1);
  });

  it("throws InsiderUnavailableError for an unverified insider", async () => {
    const { db, seedConfig, seedCompany } = createFakeDatabase();
    seedConfig({ key: "rules", version: 1, placeholder: true, value: RULES_VALUE });
    const company = seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const seekerUser = await db.identity.findOrCreateUser("fb-s2", "s2@x.com", "seeker");
    const seekerProfile = await db.identity.createSeekerProfile(seekerUser.id, "S2");
    const insiderUser = await db.identity.findOrCreateUser("fb-i2", "i2@acme.com", "seeker");
    const insiderProfile = await db.identity.findOrCreateInsiderProfile(insiderUser.id, company.id, "i2@acme.com");
    // deliberately not verified

    await expect(
      sendRequest({ db }, { idempotencyKey: "k3", seekerProfileId: seekerProfile.id, insiderProfileId: insiderProfile.id })
    ).rejects.toThrow(InsiderUnavailableError);
  });

  it("throws InsiderUnavailableError for an unavailable insider", async () => {
    const { deps, seekerProfileId, insiderProfileId } = await makeVerifiedInsiderAndFundedSeeker(5);
    await deps.db.insiders.setAvailability(insiderProfileId, false);
    await expect(
      sendRequest(deps, { idempotencyKey: "k4", seekerProfileId, insiderProfileId })
    ).rejects.toThrow(InsiderUnavailableError);
  });

  it("propagates InsufficientBalanceError when the seeker cannot afford the request", async () => {
    const { deps, seekerProfileId, insiderProfileId } = await makeVerifiedInsiderAndFundedSeeker(1);
    await expect(
      sendRequest(deps, { idempotencyKey: "k5", seekerProfileId, insiderProfileId })
    ).rejects.toThrow();
  });
});

describe("accept", () => {
  it("moves a SENT request to ACCEPTED with no ledger movement", async () => {
    const { deps, seekerProfileId, insiderProfileId } = await makeVerifiedInsiderAndFundedSeeker(5);
    const request = await sendRequest(deps, { idempotencyKey: "k6", seekerProfileId, insiderProfileId });
    const updated = await accept(deps, request.id);
    expect(updated.state).toBe("ACCEPTED");
    expect(await deps.db.ledger.getBalance("escrow", request.id, "credits")).toBe(3);
  });

  it("throws when accepting a request that is not SENT", async () => {
    const { deps, seekerProfileId, insiderProfileId } = await makeVerifiedInsiderAndFundedSeeker(5);
    const request = await sendRequest(deps, { idempotencyKey: "k7", seekerProfileId, insiderProfileId });
    await accept(deps, request.id);
    await expect(accept(deps, request.id)).rejects.toThrow(InvalidTransitionError);
  });
});

describe("decline", () => {
  it("refunds the full cost to the seeker at 100% refundPercentOnDecline", async () => {
    const { deps, seekerProfileId, insiderProfileId } = await makeVerifiedInsiderAndFundedSeeker(5);
    const request = await sendRequest(deps, { idempotencyKey: "k8", seekerProfileId, insiderProfileId });
    const updated = await decline(deps, request.id);
    expect(updated.state).toBe("DECLINED");
    expect(await deps.db.ledger.getBalance("seeker", seekerProfileId, "credits")).toBe(5);
    expect(await deps.db.ledger.getBalance("escrow", request.id, "credits")).toBe(0);
  });
});

describe("expire", () => {
  it("refunds refundPercentOnExpiry (60%) to the seeker and the remainder to the platform", async () => {
    const { deps, seekerProfileId, insiderProfileId } = await makeVerifiedInsiderAndFundedSeeker(5);
    const request = await sendRequest(deps, { idempotencyKey: "k9", seekerProfileId, insiderProfileId });
    const updated = await expire(deps, request.id);
    expect(updated.state).toBe("EXPIRED");
    // creditCost 3, 60% refund = round(1.8) = 2, forfeit = 1
    expect(await deps.db.ledger.getBalance("seeker", seekerProfileId, "credits")).toBe(4);
    expect(await deps.db.ledger.getBalance("platform", "platform", "credits")).toBe(-4); // -5 grant + 1 forfeit
    expect(await deps.db.ledger.getBalance("escrow", request.id, "credits")).toBe(0);
  });

  it("is a no-op when the request is no longer SENT", async () => {
    const { deps, seekerProfileId, insiderProfileId } = await makeVerifiedInsiderAndFundedSeeker(5);
    const request = await sendRequest(deps, { idempotencyKey: "k10", seekerProfileId, insiderProfileId });
    await accept(deps, request.id);

    const result = await expire(deps, request.id);
    expect(result.state).toBe("ACCEPTED");
    expect(await deps.db.ledger.getBalance("seeker", seekerProfileId, "credits")).toBe(2);
  });

  it("is idempotent when called twice on an already-expired request (simulating a retried timer job)", async () => {
    const { deps, seekerProfileId, insiderProfileId } = await makeVerifiedInsiderAndFundedSeeker(5);
    const request = await sendRequest(deps, { idempotencyKey: "k11", seekerProfileId, insiderProfileId });
    const first = await expire(deps, request.id);
    const second = await expire(deps, request.id);
    expect(second.state).toBe(first.state);
    expect(await deps.db.ledger.getBalance("seeker", seekerProfileId, "credits")).toBe(4);
  });
});
```

- [ ] **Step 10: Run test to verify it fails**

Run: `npx vitest run src/modules/requests/requests.test.ts`
Expected: FAIL — `./requests` does not exist yet.

- [ ] **Step 11: Write `src/modules/requests/requests.ts`**

```ts
import type { Database, InsiderRequestRecord, PostLedgerEntryInput } from "../../adapters/db/types";
import { RequestStateConflictError } from "../../adapters/db/types";
import { getRulesWithVersion } from "../config/config";
import { getInsider } from "../insiders/insiders";
import { escrowFor, platformAccount } from "../ledger/ledger";
import { nextState, type RequestState } from "./state";

export interface RequestsDeps {
  db: Database;
}

export class InsiderUnavailableError extends Error {
  constructor(insiderProfileId: string) {
    super(`Insider ${insiderProfileId} is not available to receive requests (not verified or not available)`);
    this.name = "InsiderUnavailableError";
  }
}

export interface SendRequestInput {
  idempotencyKey: string;
  seekerProfileId: string;
  insiderProfileId: string;
}

export async function sendRequest(deps: RequestsDeps, input: SendRequestInput): Promise<InsiderRequestRecord> {
  const profile = await deps.db.identity.getInsiderProfileById(input.insiderProfileId);
  if (!profile || profile.verifiedAt === null || !profile.available) {
    throw new InsiderUnavailableError(input.insiderProfileId);
  }

  const summary = await getInsider(deps, input.insiderProfileId);
  if (!summary) throw new InsiderUnavailableError(input.insiderProfileId);

  const { version: rulesVersion } = await getRulesWithVersion(deps);

  return deps.db.requests.sendRequest({
    idempotencyKey: input.idempotencyKey,
    seekerProfileId: input.seekerProfileId,
    insiderProfileId: input.insiderProfileId,
    companyId: profile.companyId,
    creditCost: summary.creditCost,
    rulesVersion,
  });
}

function refundEntries(
  requestId: string,
  seekerProfileId: string,
  creditCost: number,
  refundPercent: number
): PostLedgerEntryInput[] {
  const refundAmount = Math.round((creditCost * refundPercent) / 100);
  const forfeitAmount = creditCost - refundAmount;
  const entries: PostLedgerEntryInput[] = [
    { ...escrowFor(requestId), currency: "credits", amount: -creditCost },
  ];
  if (refundAmount > 0) {
    entries.push({ ownerType: "seeker", ownerId: seekerProfileId, currency: "credits", amount: refundAmount });
  }
  if (forfeitAmount > 0) {
    entries.push({ ...platformAccount(), currency: "credits", amount: forfeitAmount });
  }
  return entries;
}

export async function accept(deps: RequestsDeps, requestId: string): Promise<InsiderRequestRecord> {
  const record = await deps.db.requests.getById(requestId);
  if (!record) throw new Error(`Insider request ${requestId} not found`);
  const toState = nextState(record.state as RequestState, "accept");

  return deps.db.requests.applyTransition({
    idempotencyKey: `request:${requestId}:accept`,
    requestId,
    event: "accept",
    fromState: record.state,
    toState,
    ledgerEntries: [],
    ledgerEventType: "request.accept",
  });
}

export async function decline(deps: RequestsDeps, requestId: string): Promise<InsiderRequestRecord> {
  const record = await deps.db.requests.getById(requestId);
  if (!record) throw new Error(`Insider request ${requestId} not found`);
  const toState = nextState(record.state as RequestState, "decline");
  const { rules } = await getRulesWithVersion(deps);
  const entries = refundEntries(requestId, record.seekerProfileId, record.creditCost, rules.refundPercentOnDecline);

  return deps.db.requests.applyTransition({
    idempotencyKey: `request:${requestId}:decline`,
    requestId,
    event: "decline",
    fromState: record.state,
    toState,
    ledgerEntries: entries,
    ledgerEventType: "request.decline",
  });
}

export async function expire(deps: RequestsDeps, requestId: string): Promise<InsiderRequestRecord> {
  const record = await deps.db.requests.getById(requestId);
  if (!record) throw new Error(`Insider request ${requestId} not found`);
  if (record.state !== "SENT") return record;

  const toState = nextState(record.state as RequestState, "expire");
  const { rules } = await getRulesWithVersion(deps);
  const entries = refundEntries(requestId, record.seekerProfileId, record.creditCost, rules.refundPercentOnExpiry);

  try {
    return await deps.db.requests.applyTransition({
      idempotencyKey: `request:${requestId}:expire`,
      requestId,
      event: "expire",
      fromState: record.state,
      toState,
      ledgerEntries: entries,
      ledgerEventType: "request.expire",
    });
  } catch (err) {
    if (err instanceof RequestStateConflictError) {
      const current = await deps.db.requests.getById(requestId);
      if (current) return current;
    }
    throw err;
  }
}
```
(`RequestsDeps = { db: Database }` is structurally compatible with `InsidersDeps`/`ConfigDeps`, so `getInsider(deps, ...)` and `getRulesWithVersion(deps)` typecheck without any adapter. `expire`'s try/catch handles the race window between its own `getById` read and the adapter's write — if another caller changed the request's state in between, the adapter throws `RequestStateConflictError`, which `expire` treats as "someone else already moved it" and resolves by returning the current record, matching AGENTS.md §3.4's "no-op unless still SENT" requirement for the future timer job that will call this function. `accept`/`decline` do NOT catch this error — a genuine state conflict on a direct user action is a real error the caller should see, not silently swallowed.)

- [ ] **Step 12: Run tests to verify they pass**

Run: `npx vitest run src/modules/requests/requests.test.ts`
Expected: PASS (13 tests).
Run: `npm test` — full suite passes.
Run: `npm run typecheck` and `npm run lint` — both clean.

- [ ] **Step 13: Commit**

```bash
git add src/modules/ledger src/modules/config src/modules/requests
git commit -m "feat(requests): add sendRequest, accept, decline, expire with escrow"
```

---

## Plan Self-Review Notes

- **Spec coverage:** AGENTS.md §3.11's "`requests.sendRequest` with escrow → accept/decline/expire" is fully covered. §1.5's same-transaction requirement is honored by construction (Task 2's `sendRequest`/`applyTransition` are each single atomic adapter calls). §3.3's ledger rules are honored: idempotency keys derived from the triggering event, zero-sum entries, escrow as a real per-request account, `SELECT ... FOR UPDATE` on affected accounts before posting.
- **Deliberately deferred, with rationale stated inline (see "Scope note" above):** proof/admin-verify, interview confirmation, the pg-boss timer jobs that call `expire`/sweep on a schedule, email notifications, rewards, weekly Insider request-capacity limits. Each is called out with why it doesn't belong in this plan.
- **Type consistency:** `InsiderRequestRecord`/`SendInsiderRequestInput`/`ApplyRequestTransitionInput` (Task 2) are used identically by fake.ts, real.ts, and the `requests` module (Task 3) — checked field-for-field. `RequestState`/`RequestEvent`/`nextState`/`InvalidTransitionError` from the already-existing `state.ts` are consumed, not redefined. `platformAccount()`/`getRulesWithVersion()` (Task 3) follow the exact shape of the pre-existing `escrowFor()`/`getRules()` they sit beside.
- **Next plan:** proof submission + admin verification (`submitProof`, `verifyProof` — needs a `verification_proofs` table and the beginnings of an `admin` module for `reviewProof`) → interview confirmation (`confirmInterview`, `closeWindow`) → the pg-boss timer wiring that actually calls `expire`/`windowExpiry` on a schedule (this requires the Phase 0 `src/jobs/worker.ts` entry point, already scaffolded, to register real job handlers) → email notifications → `rewards` on the manual vendor → Playwright flows for the three critical paths named in AGENTS.md §3.8. This is the second-largest remaining Phase 1 backend slice; recommend its own dedicated planning pass, matching the decomposition principle used throughout Phase 1 so far.
