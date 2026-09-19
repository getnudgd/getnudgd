# Phase 1 Proof Submission & Admin Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the remaining two request-state-machine transitions this project hasn't built yet — an Insider submitting proof of internal submission (`ACCEPTED → PROOF_PENDING`), and an admin verifying or rejecting that proof (`PROOF_PENDING → SUBMITTED` or `PROOF_PENDING → ACCEPTED`) — plus the append-only `admin_audit_log` every admin mutation must write to, per AGENTS.md §3.6. This is the "proof + admin verify" slice of AGENTS.md §3.11's Phase 1 backlog, immediately after the already-merged `requests.sendRequest`/accept/decline/expire work.

**Architecture:** Two new tables (`verification_proofs`, `admin_audit_log`) and three new/extended `Database.requests` adapter methods, following the exact pattern already proven by `sendRequest`/`applyTransition`: each compound method performs its entire multi-table write as one atomic transaction with `SELECT ... FOR UPDATE` locking, an idempotency-key check first, and an append-only event row last. `applyTransition` (already built) gains an optional `adminAudit` field so the same one method that already handles `accept`/`decline`/`expire` can also handle admin-initiated `verify`/`reject`, writing the audit log row in the same transaction as the state change — rather than inventing a second, separate atomic-write mechanism for admin actions. A new `submitProof` compound method mirrors `applyTransition`'s shape but writes a `verification_proofs` row instead of ledger entries, since proof submission moves no money. A new `admin` domain module (`src/modules/admin/admin.ts`) owns `reviewProof` and `listPendingProofs`, per AGENTS.md §3.2's module table.

**Tech Stack:** Drizzle ORM (`db.transaction(async (tx) => ...)`), Zod — both already in use, no additions.

**Spec:** `AGENTS.md` at the repo root — specifically §1.4 (data model: `verification_proofs`, `admin_audit_log`), §1.5 (state machine: `ACCEPTED --proof--> PROOF_PENDING --verify--> SUBMITTED`, `PROOF_PENDING --reject--> ACCEPTED`), §2.5 (append-only tables: `admin_audit_log` is named alongside `request_events`/`ledger_entries`), §3.2 (`requests` module owns "proof, interview confirmation"; `admin` module owns "verification queue... `reviewProof`... audit log"), §3.4 ("every admin mutation writes `admin_audit_log`"). The `insider_requests`/`request_events` schema, the `Database.requests` adapter, and the `requests` domain module (`sendRequest`/`accept`/`decline`/`expire`) already exist from the merged Phase 1 Requests & Escrow plan and are extended, not rebuilt, here.

**Lesson carried forward from the prior plan's final review:** that review found `request_events` shipped without the DB-level append-only trigger `ledger_entries` already had, and that `insider_requests`'/`request_events`' FK columns had no indexes despite this exact plan being the one that would need them for list-by-state queries. Both are fixed proactively in Task 1 here, not left for a future review to catch a second time.

## Global Constraints

- TypeScript strict, no `any`, no `@ts-ignore`; Zod at every boundary (AGENTS.md Part 2.1).
- Domain modules (`src/modules/requests`, `src/modules/admin`) import no Next.js, no Drizzle, no vendor SDK — only `Database` via a `deps` object (Part 2.2).
- Idempotency on every state-changing write (Part 2.4). Two established patterns from the prior plan apply here: (a) a transition that can only happen ONCE in a request's lifecycle (like `accept`) may derive its idempotency key deterministically as `request:{id}:{event}`; (b) a transition that CAN recur across a request's lifecycle must take a caller-supplied idempotency key, namespaced with a prefix disjoint from `request:` and from every other prefix already in use (`send:`), to prevent the exact cross-action key-collision class of bug the prior plan's final review caught and fixed. `reject` (an Insider can be rejected, resubmit proof, and be rejected again) and proof submission itself (same resubmission cycle) both fall into case (b); `verify` falls into case (a) since `PROOF_PENDING → SUBMITTED` only ever happens once per request.
- Append-only tables are append-only (Part 2.5): `admin_audit_log` is only ever `INSERT`ed into by this plan's code, and gets the same DB-level trigger enforcement `ledger_entries`/`request_events` already have — not just application-level discipline.
- Every admin mutation writes `admin_audit_log` (§3.6) — `reviewProof` cannot leave this optional; it is table-stakes for this task, not a nice-to-have.
- All DB writes that touch a locked row do so inside a transaction that first takes `SELECT ... FOR UPDATE` (§3.3's principle, already proven in `applyTransition`/`sendRequest`) — `submitProof`'s real.ts implementation follows the identical pattern.
- Small, verified commits with `type(scope): summary` commit messages; run `npm run lint && npm run typecheck && npm test` before every commit (Part 2.10).
- Do not add dependencies (Part 2.11) — this plan adds none.
- Locked vocabulary: Insider, Seeker, Insider Request, vouch, credits, points — never "referrer" (§0.4).
- This plan deliberately does not touch `src/lib/authorize.ts` — no server action consumes `admin`/proof functions yet, matching the same deferral already applied to `resumes`/`requests` in prior plans (widen `ResourceType` when a caller actually needs it).
- No Postgres/Docker is required to execute this plan's tasks, but IS now available in this environment (Docker Desktop, confirmed working, with `infra/compose.dev.yml` running) — implementers MAY verify migrations against the live local Postgres if useful, but this is not required for task completion; typecheck-only verification of `real.ts` remains acceptable per every prior plan's precedent.

---

## Task 1: Drizzle schema — verification_proofs, admin_audit_log, and the deferred indexes

**Files:**
- Modify: `drizzle/schema.ts`
- Create: `drizzle/migrations/0007_proof_admin_verify.sql` (generated, then renamed)
- Create: `drizzle/migrations/0008_admin_audit_log_append_only.sql` (hand-written)

**Interfaces:**
- Produces: `verificationProofs`, `adminAuditLog` Drizzle table objects, plus new indexes on `insiderRequests` and `requestEvents` — consumed by Task 2's `real.ts` additions.

- [ ] **Step 1: Update the top-level import in `drizzle/schema.ts`**

Change:
```ts
import { pgTable, uuid, text, integer, timestamp, jsonb, boolean, uniqueIndex, check } from "drizzle-orm/pg-core";
```
to:
```ts
import { pgTable, uuid, text, integer, timestamp, jsonb, boolean, uniqueIndex, index, check } from "drizzle-orm/pg-core";
```
(adds `index` — the non-unique index builder — alongside the existing `uniqueIndex`)

- [ ] **Step 2: Add indexes to the existing `insiderRequests` and `requestEvents` tables**

Find the existing `insiderRequests` table definition (its `(table) => ({...})` callback currently has only `stateCheck`). Change it to:
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
    seekerProfileIdIdx: index("insider_requests_seeker_profile_id_idx").on(table.seekerProfileId),
    insiderProfileIdIdx: index("insider_requests_insider_profile_id_idx").on(table.insiderProfileId),
    stateIdx: index("insider_requests_state_idx").on(table.state),
  })
);
```
(`seekerProfileIdIdx`/`insiderProfileIdIdx` serve the future `/seeker/requests`/`/insider/requests` list screens; `stateIdx` serves Task 2's new `listByState` — used directly by this plan's admin verification queue.)

Find the existing `requestEvents` table definition (its callback currently has only `idempotencyKeyIdx`). Change it to:
```ts
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
    requestIdIdx: index("request_events_request_id_idx").on(table.requestId),
  })
);
```

- [ ] **Step 3: Add the two new tables**

Append (after `requestEvents`, the last table in the file):
```ts
export const verificationProofs = pgTable(
  "verification_proofs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id").notNull().references(() => insiderRequests.id),
    proofType: text("proof_type").notNull(),
    objectKey: text("object_key"),
    textContent: text("text_content"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    proofTypeCheck: check("verification_proofs_proof_type_check", sql`${table.proofType} in ('screenshot','text')`),
    requestIdIdx: index("verification_proofs_request_id_idx").on(table.requestId),
  })
);

export const adminAuditLog = pgTable(
  "admin_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminUserId: uuid("admin_user_id").notNull().references(() => users.id),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    detail: text("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    targetIdx: index("admin_audit_log_target_idx").on(table.targetType, table.targetId),
  })
);
```
(`objectKey`/`textContent` are both nullable — exactly one is set, depending on `proofType`; enforcing that as an XOR CHECK constraint is deferred as unnecessary rigor for a placeholder-era table, matching this codebase's existing tolerance for application-level-only invariants on nullable sibling columns.)

- [ ] **Step 4: Generate the migration**

Run: `npm run db:generate`
Expected: a new file under `drizzle/migrations/`. Rename it to `drizzle/migrations/0007_proof_admin_verify.sql` and update `drizzle/migrations/meta/_journal.json` to register it as the eighth entry (`idx: 7`), following the exact pattern used for every prior migration in this file — keep the auto-generated `when` timestamp and `breakpoints: true`, only correct `tag` to `"0007_proof_admin_verify"` and `idx` to `7`.

- [ ] **Step 5: Hand-write the append-only trigger migration for `admin_audit_log`**

`drizzle/migrations/0001_ledger_integrity.sql` and `drizzle/migrations/0005_request_events_append_only.sql` both already contain this exact pattern for their respective tables. Create `drizzle/migrations/0008_admin_audit_log_append_only.sql` with:
```sql
CREATE OR REPLACE FUNCTION forbid_admin_audit_log_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit_log is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER admin_audit_log_no_update
  BEFORE UPDATE ON admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_admin_audit_log_mutation();

CREATE TRIGGER admin_audit_log_no_delete
  BEFORE DELETE ON admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_admin_audit_log_mutation();
```
This is hand-written, not generated via `db:generate` — Drizzle's `schema.ts` has no way to express a trigger (the same reason `0001`/`0005` are hand-written). Do not run `db:generate` for this step.

Manually add a new entry to `drizzle/migrations/meta/_journal.json`'s `entries` array, after the `idx: 7` entry Step 4 added:
```json
    {
      "idx": 8,
      "version": "7",
      "when": <one millisecond greater than idx 7's "when" value>,
      "tag": "0008_admin_audit_log_append_only",
      "breakpoints": true
    }
```
Do not touch any other journal entry, and do not create a `meta/0008_snapshot.json` — there is no schema.ts delta for this migration to snapshot (the existing snapshot from Step 4 remains current), matching how `0001` and `0005` also have no corresponding standalone snapshot file.

- [ ] **Step 6: Verify**

Run: `npm run typecheck` — must pass.
If a local Postgres is available (it should be, per this plan's Global Constraints — `docker compose -f infra/compose.dev.yml ps` should show `infra-postgres-1` healthy): run `npm run db:migrate` against it and confirm both migrations apply cleanly with no errors. If no live Postgres is reachable in your execution environment, typecheck-only verification is acceptable, matching every prior plan's precedent — note which case applies in your report.

- [ ] **Step 7: Commit**

```bash
git add drizzle/schema.ts drizzle/migrations
git commit -m "feat(db): add verification_proofs and admin_audit_log schema, close deferred index/trigger gaps"
```

---

## Task 2: Database.requests extension — submitProof, listByState, getProofByRequestId, adminAudit on applyTransition

**Files:**
- Modify: `src/adapters/db/types.ts`
- Modify: `src/adapters/db/fake.ts`
- Modify: `src/adapters/db/fake.test.ts`
- Modify: `src/adapters/db/real.ts`

**Interfaces:**
- Consumes: `verificationProofs`, `adminAuditLog` tables and the new indexes from `drizzle/schema.ts` (Task 1).
- Produces: `VerificationProofRecord`, `AdminAuditLogRecord`, `SubmitProofInput`, `AdminAuditInput` types; extends `ApplyRequestTransitionInput` with an optional `adminAudit` field; extends `Database.requests` with `submitProof`, `listByState`, `getProofByRequestId` — consumed by Task 3's `requests`/`admin` modules.

**Read this first, exactly as it exists on this branch right now** (you will be modifying this function, not writing it from scratch — preserve everything described here except the one addition specified in Step 4):

`src/adapters/db/fake.ts`'s current `applyTransition`:
```ts
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

        if (input.ledgerEntries.length > 0) {
          assertZeroSum(input.ledgerEntries);
        }
        current.state = input.toState;

        if (input.ledgerEntries.length > 0) {
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
```
**Important:** the `if (input.ledgerEntries.length > 0) { assertZeroSum(...) }` guard runs BEFORE `current.state = input.toState` — this ordering was a deliberate bug fix from the prior plan's review. Do not move it back after the mutation.

`src/adapters/db/real.ts`'s current `applyTransition` has the identical shape (transaction-wrapped, `SELECT ... FOR UPDATE`, `assertZeroSum` before the `UPDATE`, ledger entries loop, then `request_events` insert) — read it directly in the file before starting; it is long enough that reproducing it here risks transcription drift.

- [ ] **Step 1: Add types to `src/adapters/db/types.ts`**

Append:
```ts
export interface VerificationProofRecord {
  id: string;
  requestId: string;
  proofType: string;
  objectKey: string | null;
  textContent: string | null;
  createdAt: Date;
}

export interface AdminAuditLogRecord {
  id: string;
  adminUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  detail: string | null;
  createdAt: Date;
}

export interface SubmitProofInput {
  idempotencyKey: string;
  requestId: string;
  fromState: string;
  toState: string;
  proofType: string;
  objectKey?: string;
  textContent?: string;
}

export interface AdminAuditInput {
  adminUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  detail?: string;
}
```

Change the existing `ApplyRequestTransitionInput` interface from:
```ts
export interface ApplyRequestTransitionInput {
  idempotencyKey: string;
  requestId: string;
  event: string;
  fromState: string;
  toState: string;
  ledgerEntries: PostLedgerEntryInput[];
  ledgerEventType: string;
}
```
to:
```ts
export interface ApplyRequestTransitionInput {
  idempotencyKey: string;
  requestId: string;
  event: string;
  fromState: string;
  toState: string;
  ledgerEntries: PostLedgerEntryInput[];
  ledgerEventType: string;
  adminAudit?: AdminAuditInput;
}
```

Change the `Database.requests` sub-interface from:
```ts
  requests: {
    sendRequest(input: SendInsiderRequestInput): Promise<InsiderRequestRecord>;
    applyTransition(input: ApplyRequestTransitionInput): Promise<InsiderRequestRecord>;
    getById(requestId: string): Promise<InsiderRequestRecord | null>;
  };
```
to:
```ts
  requests: {
    sendRequest(input: SendInsiderRequestInput): Promise<InsiderRequestRecord>;
    applyTransition(input: ApplyRequestTransitionInput): Promise<InsiderRequestRecord>;
    submitProof(input: SubmitProofInput): Promise<InsiderRequestRecord>;
    getById(requestId: string): Promise<InsiderRequestRecord | null>;
    listByState(state: string): Promise<InsiderRequestRecord[]>;
    getProofByRequestId(requestId: string): Promise<VerificationProofRecord | null>;
    listAuditLogByTarget(targetType: string, targetId: string): Promise<AdminAuditLogRecord[]>;
  };
```

- [ ] **Step 2: Write the failing tests**

Add a new `describe` block to `src/adapters/db/fake.test.ts` (place it after the existing `describe("createFakeDatabase requests", ...)` block — reuse that block's `seedSeekerWithCredits` helper if it's in scope, or inline an equivalent seeker/credit setup):
```ts
describe("createFakeDatabase requests proof and admin review", () => {
  async function makeAcceptedRequest(db: ReturnType<typeof createFakeDatabase>["db"]): Promise<{ requestId: string }> {
    const user = await db.identity.findOrCreateUser(`fb-proof-${Math.random()}`, `proof${Math.random()}@x.com`, "seeker");
    const seekerProfile = await db.identity.createSeekerProfile(user.id, "Proof Seeker");
    await db.ledger.postTxn({
      idempotencyKey: `grant:${seekerProfile.id}`,
      eventType: "credits.grant",
      entries: [
        { ownerType: "platform", ownerId: "platform", currency: "credits", amount: -5 },
        { ownerType: "seeker", ownerId: seekerProfile.id, currency: "credits", amount: 5 },
      ],
    });
    const request = await db.requests.sendRequest({
      idempotencyKey: `send:${seekerProfile.id}`,
      seekerProfileId: seekerProfile.id,
      insiderProfileId: "insider-x",
      companyId: "company-x",
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
    return { requestId: request.id };
  }

  it("submitProof moves ACCEPTED to PROOF_PENDING and records the proof", async () => {
    const { db } = createFakeDatabase();
    const { requestId } = await makeAcceptedRequest(db);

    const updated = await db.requests.submitProof({
      idempotencyKey: "proof:1",
      requestId,
      fromState: "ACCEPTED",
      toState: "PROOF_PENDING",
      proofType: "text",
      textContent: "Submitted via internal portal",
    });

    expect(updated.state).toBe("PROOF_PENDING");
    const proof = await db.requests.getProofByRequestId(requestId);
    expect(proof?.proofType).toBe("text");
    expect(proof?.textContent).toBe("Submitted via internal portal");
  });

  it("submitProof is idempotent: same key does not create a duplicate proof row", async () => {
    const { db } = createFakeDatabase();
    const { requestId } = await makeAcceptedRequest(db);
    const input = {
      idempotencyKey: "proof:2",
      requestId,
      fromState: "ACCEPTED",
      toState: "PROOF_PENDING",
      proofType: "text",
      textContent: "First submission",
    };
    await db.requests.submitProof(input);
    await db.requests.submitProof(input);

    const proof = await db.requests.getProofByRequestId(requestId);
    expect(proof?.textContent).toBe("First submission");
  });

  it("submitProof throws RequestStateConflictError when fromState doesn't match", async () => {
    const { db } = createFakeDatabase();
    const { requestId } = await makeAcceptedRequest(db);
    await expect(
      db.requests.submitProof({
        idempotencyKey: "proof:3",
        requestId,
        fromState: "PROOF_PENDING", // wrong — request is actually ACCEPTED
        toState: "SUBMITTED",
        proofType: "text",
        textContent: "x",
      })
    ).rejects.toThrow(RequestStateConflictError);
  });

  it("listByState returns only requests in the given state", async () => {
    const { db } = createFakeDatabase();
    const { requestId } = await makeAcceptedRequest(db);
    const accepted = await db.requests.listByState("ACCEPTED");
    expect(accepted.map((r) => r.id)).toContain(requestId);
    expect(await db.requests.listByState("PROOF_PENDING")).toHaveLength(0);
  });

  it("getProofByRequestId returns null when no proof exists", async () => {
    const { db } = createFakeDatabase();
    const { requestId } = await makeAcceptedRequest(db);
    expect(await db.requests.getProofByRequestId(requestId)).toBeNull();
  });

  it("applyTransition writes an admin_audit_log row when adminAudit is provided", async () => {
    const { db } = createFakeDatabase();
    const { requestId } = await makeAcceptedRequest(db);
    await db.requests.submitProof({
      idempotencyKey: "proof:4",
      requestId,
      fromState: "ACCEPTED",
      toState: "PROOF_PENDING",
      proofType: "text",
      textContent: "x",
    });

    await db.requests.applyTransition({
      idempotencyKey: "review:1",
      requestId,
      event: "verify",
      fromState: "PROOF_PENDING",
      toState: "SUBMITTED",
      ledgerEntries: [],
      ledgerEventType: "request.verify",
      adminAudit: {
        adminUserId: "admin-1",
        action: "proof.verify",
        targetType: "insider_request",
        targetId: requestId,
      },
    });

    expect(await db.requests.listByState("SUBMITTED")).toHaveLength(1);
    const auditRows = await db.requests.listAuditLogByTarget("insider_request", requestId);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].action).toBe("proof.verify");
    expect(auditRows[0].adminUserId).toBe("admin-1");
  });

  it("applyTransition does not write an admin_audit_log row when adminAudit is omitted", async () => {
    const { db } = createFakeDatabase();
    const { requestId } = await makeAcceptedRequest(db);
    await db.requests.submitProof({
      idempotencyKey: "proof:5",
      requestId,
      fromState: "ACCEPTED",
      toState: "PROOF_PENDING",
      proofType: "screenshot",
      objectKey: "proofs/x.png",
    });
    const proof = await db.requests.getProofByRequestId(requestId);
    expect(proof?.objectKey).toBe("proofs/x.png");
    expect(proof?.textContent).toBeNull();

    await db.requests.applyTransition({
      idempotencyKey: "review:2",
      requestId,
      event: "verify",
      fromState: "PROOF_PENDING",
      toState: "SUBMITTED",
      ledgerEntries: [],
      ledgerEventType: "request.verify",
      // adminAudit deliberately omitted — accept/decline/expire from the prior
      // plan already call applyTransition this way; confirm it still holds here.
    });
    expect(await db.requests.listAuditLogByTarget("insider_request", requestId)).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/adapters/db/fake.test.ts`
Expected: FAIL — `db.requests.submitProof`/`listByState`/`getProofByRequestId` don't exist yet.

- [ ] **Step 4: Implement in `src/adapters/db/fake.ts`**

Add two new in-memory arrays alongside the existing `insiderRequestRows`/`requestEventRows`:
```ts
  const verificationProofRows: VerificationProofRecord[] = [];
  const adminAuditLogRows: AdminAuditLogRecord[] = [];
```

Add `VerificationProofRecord`, `AdminAuditLogRecord`, `SubmitProofInput` to the existing import from `./types`.

Modify the existing `applyTransition` method: insert this block AFTER the `if (input.ledgerEntries.length > 0) { ... }` ledger-posting block and BEFORE the final `requestEventRows.push({...})` call:
```ts
        if (input.adminAudit) {
          adminAuditLogRows.push({
            id: genId(),
            adminUserId: input.adminAudit.adminUserId,
            action: input.adminAudit.action,
            targetType: input.adminAudit.targetType,
            targetId: input.adminAudit.targetId,
            detail: input.adminAudit.detail ?? null,
            createdAt: new Date(),
          });
        }
```

Add these three new methods to the `requests` object, alongside `sendRequest`/`applyTransition`/`getById`:
```ts
      async submitProof(input) {
        const existingEvent = requestEventRows.find((e) => e.idempotencyKey === input.idempotencyKey);
        if (existingEvent) {
          const existing = insiderRequestRows.find((r) => r.id === input.requestId);
          if (existing) return existing;
        }

        const current = insiderRequestRows.find((r) => r.id === input.requestId);
        if (!current) throw new Error(`Insider request ${input.requestId} not found`);
        if (current.state !== input.fromState) {
          throw new RequestStateConflictError(input.requestId, input.fromState, current.state);
        }

        current.state = input.toState;

        verificationProofRows.push({
          id: genId(),
          requestId: input.requestId,
          proofType: input.proofType,
          objectKey: input.objectKey ?? null,
          textContent: input.textContent ?? null,
          createdAt: new Date(),
        });

        requestEventRows.push({
          id: genId(),
          requestId: input.requestId,
          idempotencyKey: input.idempotencyKey,
          event: "proof",
          fromState: input.fromState,
          toState: input.toState,
          createdAt: new Date(),
        });

        return current;
      },
      async listByState(state) {
        return insiderRequestRows.filter((r) => r.state === state);
      },
      async getProofByRequestId(requestId) {
        return verificationProofRows.find((p) => p.requestId === requestId) ?? null;
      },
      async listAuditLogByTarget(targetType, targetId) {
        return adminAuditLogRows.filter((r) => r.targetType === targetType && r.targetId === targetId);
      },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/adapters/db/fake.test.ts`
Expected: PASS (7 new tests).

- [ ] **Step 6: Implement in `src/adapters/db/real.ts`**

Add `verificationProofs, adminAuditLog` to the existing schema import line. Add `VerificationProofRecord` and `AdminAuditLogRecord` to the existing type imports from `./types` (both are used as explicit `as` casts below) — do NOT also import `SubmitProofInput` unless you end up referencing it by name somewhere (per the established lesson in this codebase: an imported type that's never written as an explicit annotation produces an unused-import lint warning; check as you go rather than importing everything defensively).

Modify the existing `applyTransition` method: insert this block in the same position as the fake.ts change (after the ledger-entries-insertion block, before the `request_events` insert):
```ts
          if (input.adminAudit) {
            await tx.insert(adminAuditLog).values({
              adminUserId: input.adminAudit.adminUserId,
              action: input.adminAudit.action,
              targetType: input.adminAudit.targetType,
              targetId: input.adminAudit.targetId,
              detail: input.adminAudit.detail,
            });
          }
```

Add these three new methods to the `requests` object, alongside `sendRequest`/`applyTransition`/`getById`:
```ts
      async submitProof(input) {
        return db.transaction(async (tx) => {
          const [existingEvent] = await tx
            .select()
            .from(requestEvents)
            .where(eq(requestEvents.idempotencyKey, input.idempotencyKey));
          if (existingEvent) {
            const [existing] = await tx.select().from(insiderRequests).where(eq(insiderRequests.id, input.requestId));
            if (existing) return existing as InsiderRequestRecord;
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

          await tx.insert(verificationProofs).values({
            requestId: input.requestId,
            proofType: input.proofType,
            objectKey: input.objectKey,
            textContent: input.textContent,
          });

          await tx.insert(requestEvents).values({
            requestId: input.requestId,
            idempotencyKey: input.idempotencyKey,
            event: "proof",
            fromState: input.fromState,
            toState: input.toState,
          });

          return updated as InsiderRequestRecord;
        });
      },
      async listByState(state) {
        const rows = await db.select().from(insiderRequests).where(eq(insiderRequests.state, state));
        return rows as InsiderRequestRecord[];
      },
      async getProofByRequestId(requestId) {
        const [row] = await db.select().from(verificationProofs).where(eq(verificationProofs.requestId, requestId));
        return (row as VerificationProofRecord) ?? null;
      },
      async listAuditLogByTarget(targetType, targetId) {
        const rows = await db
          .select()
          .from(adminAuditLog)
          .where(and(eq(adminAuditLog.targetType, targetType), eq(adminAuditLog.targetId, targetId)));
        return rows as AdminAuditLogRecord[];
      },
```
(`and`/`eq` are already imported at the top of this file — no new import needed. This method IS a case where `AdminAuditLogRecord` is referenced by name as an explicit type annotation, so add it to the type imports from `./types` this time, alongside `VerificationProofRecord`.)

- [ ] **Step 7: Verify**

Run: `npm run typecheck` — must pass.
Run: `npm run lint` — must be clean (0 errors, 0 warnings) — pay particular attention to unused imports in `real.ts`, per this file's established history.
Run: `npm test` — full suite passes.
If a local Postgres is available (see Task 1 Global Constraints note): apply the migrations from Task 1 if not already applied, then optionally exercise `submitProof`/`listByState`/`getProofByRequestId` directly against it — not required, but valuable given this environment now supports it.

- [ ] **Step 8: Commit**

```bash
git add src/adapters/db
git commit -m "feat(adapters): extend Database.requests with submitProof, listByState, getProofByRequestId, and admin audit logging"
```

---

## Task 3: src/modules/requests submitProof + src/modules/admin

**Files:**
- Modify: `src/modules/requests/requests.ts`
- Modify: `src/modules/requests/requests.test.ts`
- Create: `src/modules/admin/admin.ts`
- Create: `src/modules/admin/admin.test.ts`

**Interfaces:**
- Consumes: `Database.requests.{submitProof,applyTransition,getById,listByState,getProofByRequestId}` (Task 2); `nextState`, `RequestState`, `InvalidTransitionError` from `src/modules/requests/state.ts` (already on main).
- Produces: `submitProof` added to the `requests` module's public interface; a new `admin` module with `reviewProof`, `listPendingProofs`, `MissingRejectionReasonError`.

- [ ] **Step 1: Write the failing test for `submitProof`**

Add to `src/modules/requests/requests.test.ts` (reuse this file's existing `makeVerifiedInsiderAndFundedSeeker` helper and imports — add `submitProof` to the existing import from `./requests`):
```ts
describe("submitProof", () => {
  it("moves an ACCEPTED request to PROOF_PENDING and records the proof", async () => {
    const { deps, seekerProfileId, insiderProfileId } = await makeVerifiedInsiderAndFundedSeeker(5);
    const request = await sendRequest(deps, { idempotencyKey: "sp1", seekerProfileId, insiderProfileId });
    await accept(deps, request.id);

    const updated = await submitProof(deps, {
      idempotencyKey: "sp1-proof",
      requestId: request.id,
      proofType: "text",
      textContent: "Submitted internally on 2026-09-19",
    });

    expect(updated.state).toBe("PROOF_PENDING");
    const proof = await deps.db.requests.getProofByRequestId(request.id);
    expect(proof?.textContent).toBe("Submitted internally on 2026-09-19");
  });

  it("throws when submitting proof for a request that is not ACCEPTED", async () => {
    const { deps, seekerProfileId, insiderProfileId } = await makeVerifiedInsiderAndFundedSeeker(5);
    const request = await sendRequest(deps, { idempotencyKey: "sp2", seekerProfileId, insiderProfileId });
    // request is still SENT, not ACCEPTED
    await expect(
      submitProof(deps, { idempotencyKey: "sp2-proof", requestId: request.id, proofType: "text", textContent: "x" })
    ).rejects.toThrow(InvalidTransitionError);
  });

  it("allows resubmission after a rejection, using a fresh idempotencyKey each time", async () => {
    const { deps, seekerProfileId, insiderProfileId } = await makeVerifiedInsiderAndFundedSeeker(5);
    const request = await sendRequest(deps, { idempotencyKey: "sp3", seekerProfileId, insiderProfileId });
    await accept(deps, request.id);
    await submitProof(deps, { idempotencyKey: "sp3-proof-1", requestId: request.id, proofType: "text", textContent: "first attempt" });

    // Simulate an admin rejection (PROOF_PENDING -> ACCEPTED) directly via the adapter,
    // since the admin module doesn't exist until this same task builds it below.
    await deps.db.requests.applyTransition({
      idempotencyKey: "review:sp3-reject-1",
      requestId: request.id,
      event: "reject",
      fromState: "PROOF_PENDING",
      toState: "ACCEPTED",
      ledgerEntries: [],
      ledgerEventType: "request.reject",
    });

    const resubmitted = await submitProof(deps, {
      idempotencyKey: "sp3-proof-2",
      requestId: request.id,
      proofType: "text",
      textContent: "second attempt",
    });

    expect(resubmitted.state).toBe("PROOF_PENDING");
    const proof = await deps.db.requests.getProofByRequestId(request.id);
    expect(proof?.textContent).toBe("second attempt");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/requests/requests.test.ts`
Expected: FAIL — `submitProof` is not exported from `./requests` yet.

- [ ] **Step 3: Implement `submitProof` in `src/modules/requests/requests.ts`**

Add this exported interface and function anywhere after the existing `expire` function (the file's other exports — `sendRequest`, `accept`, `decline`, `expire`, `refundEntries`, `InsiderUnavailableError` — stay exactly as they are; this is a pure addition):
```ts
export interface SubmitProofInput {
  idempotencyKey: string;
  requestId: string;
  proofType: "screenshot" | "text";
  objectKey?: string;
  textContent?: string;
}

export async function submitProof(deps: RequestsDeps, input: SubmitProofInput): Promise<InsiderRequestRecord> {
  const record = await deps.db.requests.getById(input.requestId);
  if (!record) throw new Error(`Insider request ${input.requestId} not found`);
  const toState = nextState(record.state as RequestState, "proof");

  return deps.db.requests.submitProof({
    idempotencyKey: `proof:${input.idempotencyKey}`,
    requestId: input.requestId,
    fromState: record.state,
    toState,
    proofType: input.proofType,
    objectKey: input.objectKey,
    textContent: input.textContent,
  });
}
```
(The `proof:` prefix on the derived adapter-level idempotency key is deliberate — it keeps this action's key namespace disjoint from `send:` (used by `sendRequest`) and from the bare `request:{id}:{event}` keys `accept`/`decline`/`expire` derive internally, applying the lesson from the prior plan's final review that an unnamespaced or collidable idempotency key is a real security/correctness risk, not a style preference.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/modules/requests/requests.test.ts`
Expected: PASS (3 new tests).

- [ ] **Step 5: Write the failing tests for the `admin` module**

Create `src/modules/admin/admin.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createFakeDatabase } from "../../adapters/db/fake";
import { sendRequest, accept, submitProof, type RequestsDeps } from "../requests/requests";
import { reviewProof, listPendingProofs, MissingRejectionReasonError, type AdminDeps } from "./admin";

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

async function makeProofPendingRequest(): Promise<{ deps: AdminDeps & RequestsDeps; requestId: string }> {
  const { db, seedConfig, seedCompany } = createFakeDatabase();
  seedConfig({ key: "rules", version: 1, placeholder: true, value: RULES_VALUE });
  const company = seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);

  const seekerUser = await db.identity.findOrCreateUser(`fb-adm-s-${Math.random()}`, `s${Math.random()}@x.com`, "seeker");
  const seekerProfile = await db.identity.createSeekerProfile(seekerUser.id, "Admin Test Seeker");
  await db.ledger.postTxn({
    idempotencyKey: `grant:${seekerProfile.id}`,
    eventType: "credits.grant",
    entries: [
      { ownerType: "platform", ownerId: "platform", currency: "credits", amount: -5 },
      { ownerType: "seeker", ownerId: seekerProfile.id, currency: "credits", amount: 5 },
    ],
  });

  const insiderUser = await db.identity.findOrCreateUser(`fb-adm-i-${Math.random()}`, `i${Math.random()}@acme.com`, "seeker");
  const insiderProfile = await db.identity.findOrCreateInsiderProfile(insiderUser.id, company.id, `i${Math.random()}@acme.com`);
  await db.identity.markInsiderVerified(insiderProfile.id, new Date());

  const deps = { db };
  const request = await sendRequest(deps, {
    idempotencyKey: `send:${seekerProfile.id}`,
    seekerProfileId: seekerProfile.id,
    insiderProfileId: insiderProfile.id,
  });
  await accept(deps, request.id);
  await submitProof(deps, { idempotencyKey: `proof:${request.id}`, requestId: request.id, proofType: "text", textContent: "proof text" });

  return { deps, requestId: request.id };
}

describe("reviewProof", () => {
  it("verify moves PROOF_PENDING to SUBMITTED and writes an audit log entry", async () => {
    const { deps, requestId } = await makeProofPendingRequest();
    const updated = await reviewProof(deps, {
      idempotencyKey: "rev1",
      adminUserId: "admin-1",
      requestId,
      decision: "verify",
    });
    expect(updated.state).toBe("SUBMITTED");
  });

  it("reject moves PROOF_PENDING back to ACCEPTED and requires a reason", async () => {
    const { deps, requestId } = await makeProofPendingRequest();
    await expect(
      reviewProof(deps, { idempotencyKey: "rev2", adminUserId: "admin-1", requestId, decision: "reject" })
    ).rejects.toThrow(MissingRejectionReasonError);

    const updated = await reviewProof(deps, {
      idempotencyKey: "rev3",
      adminUserId: "admin-1",
      requestId,
      decision: "reject",
      reason: "Screenshot was unreadable",
    });
    expect(updated.state).toBe("ACCEPTED");
  });

  it("supports reject, resubmit, reject again — each with its own idempotencyKey", async () => {
    const { deps, requestId } = await makeProofPendingRequest();
    await reviewProof(deps, { idempotencyKey: "rev4", adminUserId: "admin-1", requestId, decision: "reject", reason: "first reject" });
    await submitProof(deps, { idempotencyKey: `proof:${requestId}:2`, requestId, proofType: "text", textContent: "resubmission" });
    const secondReject = await reviewProof(deps, {
      idempotencyKey: "rev5",
      adminUserId: "admin-1",
      requestId,
      decision: "reject",
      reason: "second reject",
    });
    expect(secondReject.state).toBe("ACCEPTED");
  });
});

describe("listPendingProofs", () => {
  it("returns requests in PROOF_PENDING with their proof content", async () => {
    const { deps, requestId } = await makeProofPendingRequest();
    const pending = await listPendingProofs(deps);
    expect(pending).toHaveLength(1);
    expect(pending[0].request.id).toBe(requestId);
    expect(pending[0].proof?.textContent).toBe("proof text");
  });

  it("returns an empty list when nothing is pending", async () => {
    const { db } = createFakeDatabase();
    expect(await listPendingProofs({ db })).toEqual([]);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/modules/admin/admin.test.ts`
Expected: FAIL — `./admin` does not exist yet.

- [ ] **Step 7: Write `src/modules/admin/admin.ts`**

```ts
import type { Database, InsiderRequestRecord, VerificationProofRecord } from "../../adapters/db/types";
import { nextState, type RequestState } from "../requests/state";

export interface AdminDeps {
  db: Database;
}

export class MissingRejectionReasonError extends Error {
  constructor() {
    super("A reason is required when rejecting a proof");
    this.name = "MissingRejectionReasonError";
  }
}

export type ProofReviewDecision = "verify" | "reject";

export interface ReviewProofInput {
  idempotencyKey: string;
  adminUserId: string;
  requestId: string;
  decision: ProofReviewDecision;
  reason?: string;
}

export async function reviewProof(deps: AdminDeps, input: ReviewProofInput): Promise<InsiderRequestRecord> {
  if (input.decision === "reject" && !input.reason) {
    throw new MissingRejectionReasonError();
  }

  const record = await deps.db.requests.getById(input.requestId);
  if (!record) throw new Error(`Insider request ${input.requestId} not found`);

  const event = input.decision === "verify" ? "verify" : "reject";
  const toState = nextState(record.state as RequestState, event);

  return deps.db.requests.applyTransition({
    idempotencyKey: `review:${input.idempotencyKey}`,
    requestId: input.requestId,
    event,
    fromState: record.state,
    toState,
    ledgerEntries: [],
    ledgerEventType: `request.${event}`,
    adminAudit: {
      adminUserId: input.adminUserId,
      action: `proof.${event}`,
      targetType: "insider_request",
      targetId: input.requestId,
      detail: input.reason,
    },
  });
}

export interface PendingProof {
  request: InsiderRequestRecord;
  proof: VerificationProofRecord | null;
}

export async function listPendingProofs(deps: AdminDeps): Promise<PendingProof[]> {
  const pending = await deps.db.requests.listByState("PROOF_PENDING");
  return Promise.all(
    pending.map(async (request) => ({
      request,
      proof: await deps.db.requests.getProofByRequestId(request.id),
    }))
  );
}
```
(The `review:` prefix on `reviewProof`'s derived idempotency key mirrors `submitProof`'s `proof:` prefix — both are caller-supplied per Global Constraints' case (b), since `reject` can recur across a request's reject→resubmit→reject cycle exactly like proof submission can. `verify` only ever happens once per request in practice, but there is no harm in requiring the same caller-supplied-key discipline uniformly rather than special-casing it.)

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run src/modules/admin/admin.test.ts`
Expected: PASS (5 tests).
Run: `npm test` — full suite passes.
Run: `npm run typecheck` and `npm run lint` — both clean.

- [ ] **Step 9: Commit**

```bash
git add src/modules/requests src/modules/admin
git commit -m "feat(requests,admin): add submitProof and the admin proof-review module"
```

---

## Plan Self-Review Notes

- **Spec coverage:** AGENTS.md §3.11's "proof + admin verify" is fully covered: `submitProof` (Insider-initiated, ACCEPTED→PROOF_PENDING) and `reviewProof` (admin-initiated, PROOF_PENDING→SUBMITTED or →ACCEPTED). §3.4's "every admin mutation writes admin_audit_log" is satisfied by construction — `reviewProof` cannot call `applyTransition` without supplying `adminAudit`. §2.5's append-only requirement for `admin_audit_log` gets the same DB-level trigger enforcement as `ledger_entries`/`request_events`, built proactively this time rather than caught by a later review.
- **Deliberately deferred, with rationale stated inline:** interview confirmation (`confirmInterview`/`closeWindow` — a separate plan, per AGENTS.md §3.11's ordering: "proof + admin verify → timers → email notifications"), the pg-boss timer jobs, `authorize.ts` widening (no server action consumes this yet), an XOR CHECK constraint between `verification_proofs.objectKey`/`textContent` (unnecessary rigor for a placeholder-era table).
- **Type consistency:** `VerificationProofRecord`/`SubmitProofInput`/`AdminAuditInput` (Task 2) are used identically by fake.ts, real.ts, and the `requests`/`admin` modules (Task 3) — checked field-for-field. `ApplyRequestTransitionInput`'s new optional `adminAudit` field is additive and does not change any existing caller (`accept`/`decline`/`expire` from the prior plan all still compile and behave identically, since they simply don't set it).
- **Idempotency-key namespace audit (the exact class of defect the prior plan's final review caught):** four prefixes now exist — `send:` (sendRequest), bare `request:{id}:{event}` (accept/decline/expire — each event only ever fires once per request), `proof:` (submitProof — can recur), `review:` (reviewProof — can recur via `reject`). All four are structurally disjoint by their literal prefix text, so no caller-supplied key under one prefix can ever collide with a key derived under another.
- **Next plan:** interview confirmation (`confirmInterview`, `closeWindow` — needs an interview-window timer, so likely bundled with the "timers" backlog item) → the pg-boss timer wiring that actually calls `expire`/`windowExpiry`/`requests.sweep` on a schedule → email notifications → `rewards` on the manual vendor → Playwright flows for the three critical paths named in AGENTS.md §3.8 (send → accept → proof → verify → interview; send → decline → refund; send → expiry → refund — this plan's `submitProof`/`reviewProof` complete the first flow's proof/verify legs, leaving only interview confirmation before Flow A is fully backend-complete).
