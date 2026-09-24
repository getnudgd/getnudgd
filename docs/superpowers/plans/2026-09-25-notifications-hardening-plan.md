# Notifications Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the "hard gate" follow-ups recorded at the end of `2026-09-24-notifications-module-plan.md` so a real EmailSender / WhatsAppGateway can later be wired safely: event-derived idempotency for notification rows, a sweep that re-enqueues orphaned `pending` rows, correct failure bookkeeping in `deliverNotification`, and a live-Postgres integration test that would have caught the pg-boss regression found on 2026-09-25.

**Architecture:** (1) A nullable, uniquely-indexed `notifications.idempotency_key` (migration 0010, additive). `notify()` takes the triggering event's key, composes `{eventKey}:{template}:{userId}`, and `db.notifications.create` reports `{ record, created }`; when `created` is false `notify()` returns without enqueueing, so a racing replay of a transition can never send a second message. (2) `sweepPendingNotifications` (hourly-class cron, every 15 min) re-enqueues `notify.send` for rows still `pending` after 30 minutes, covering a failed `queue.send` after the row was written. (3) `deliverNotification` marks deterministic failures (missing user, unknown template, unparseable stored payload) `failed` and returns instead of retrying forever, and records every channel's failure cause when all channels fail. (4) A `RUN_VENDOR_TESTS=1`-guarded test runs the real `Database` notification methods and real pg-boss `send` against the dev Postgres.

**Tech Stack:** No new dependencies. Drizzle + drizzle-kit, pg-boss, Zod, Vitest (existing).

**Spec:** `docs/superpowers/specs/2026-09-24-notifications-module-design.md` (unchanged), plus the section "Final review findings and deferred follow-ups" at the end of `docs/superpowers/plans/2026-09-24-notifications-module-plan.md`, which is the design authority for this plan. Where this plan and AGENTS.md Part 2.4 / §3.4 disagree, AGENTS.md wins.

## Global Constraints

- TypeScript strict, no `any`, no `@ts-ignore`; Zod at every boundary (AGENTS.md Part 2.1).
- Domain modules (`src/modules/*`) import no Next.js, no Drizzle client, no vendor SDK — only `Database`/`QueueClient`/`EmailSender`/`WhatsAppGateway` via a `deps` object (Part 2.2).
- Idempotency on anything that sends a message (Part 2.4): the notification row's key is derived from the triggering event (`{eventKey}:{template}:{userId}`); the `notify.send` job's `singletonKey` stays exactly `notify:{notificationId}` (embeds the entity id).
- Jobs never call each other synchronously; they enqueue (§3.4). Every job handler is idempotent and re-checks current state before acting.
- Migrations: generate with drizzle-kit, never hand-edit a generated migration that has been applied elsewhere. Migration 0009 is applied to the dev DB only; 0010 must be additive (new nullable column + index only, no data rewrite, no NOT NULL).
- No business-number literal in domain code (§0.5). The sweep age (30 min), batch size (100) and cron (`*/15 * * * *`) and `retryLimit: 3` are operational constants, defined once as named exports/constants, not business rules.
- Locked vocabulary (Insider, Seeker, Insider Request, vouch, credits) in any copy; no new copy is added by this plan.
- Do not add dependencies (Part 2.11). Small verified commits; run `npm run lint && npm run typecheck && npm test` once before every commit (Part 2.10). Never commit to `main` directly.
- Real-adapter code (`src/adapters/db/real.ts`, `src/jobs/queue.real.ts`) is only verified by Task 4's live test; the fakes cannot catch vendor-library validation (lesson of 2026-09-25, see SESSION-HANDOFF §7).
- Out of scope, explicitly: real Brevo `EmailSender` / real `WhatsAppGateway` (still fakes); the fake email `sent` array growing without bound; CR/LF stripping of email subjects (belongs to the real Brevo adapter); extracting a `refundAmountFor` helper; Seeker `fullName` validation; making `users.phone` writable; an admin UI for failed notifications.

## Review Focus

- **Replayed transition must not re-notify.** A second caller whose `getById` returned a stale pre-transition state reaches `applyTransition`'s idempotent-replay branch (returns the current row, no error). The second `notify()` must create nothing and enqueue nothing. Task 1's tests pin this for `accept` (requests) and `reviewProof` (admin).
- **Two recipients of one event must both be notified.** `proof.verified` goes to the Insider and the Seeker with the same eventKey and template; the `userId` in the composed key must keep them distinct. Task 1's tests pin this.
- **A pending row whose job is genuinely in flight or retrying must not be delivered twice by the sweep.** The 30-minute age gate plus `deliverNotification`'s `sent` guard is the mitigation; a row created "just now" must not be swept. Task 2's tests pin the age gate; the residual (two workers delivering the same row at the same instant) is accepted and documented.
- **One bad row must not stop the sweep.** A `queue.send` failure for one pending row must not prevent later rows from being re-enqueued. Task 2's tests pin this.
- **Deterministic delivery failures must not retry forever and must leave a diagnosable row.** Missing user, unknown template, unparseable stored payload → row `failed` with a real message, no rethrow (pg-boss would just retry the same failure); all-channels-fail → row `failed` with every channel's cause, still rethrows so pg-boss retry fires. Task 3's tests pin this.

---

## Task Tiers (set `model` explicitly on every dispatch)

| Task | Implementer | Reviewer |
|---|---|---|
| 1 Event-derived idempotency | sonnet | opus (idempotency of message sends) |
| 2 Pending sweep | sonnet | sonnet |
| 3 Delivery failure bookkeeping | sonnet | opus (message-send failure semantics; keep diff small) |
| 4 Live integration test | sonnet | sonnet |
| Final whole-branch review | — | opus |

---

## Task 1: Event-derived idempotency for notifications (schema, DB layer, `notify()`, call sites)

**Files:**
- Modify: `drizzle/schema.ts` (notifications table)
- Create (generated): `drizzle/migrations/0010_*.sql` and `drizzle/migrations/meta/*` via `npm run db:generate`
- Modify: `src/adapters/db/types.ts`
- Modify: `src/adapters/db/fake.ts`
- Modify: `src/adapters/db/real.ts`
- Modify: `src/adapters/db/fake.test.ts`
- Modify: `src/modules/notifications/notifications.ts`
- Modify: `src/modules/notifications/notifications.test.ts`
- Modify: `src/modules/requests/requests.ts`, `src/modules/requests/requests.test.ts`
- Modify: `src/modules/admin/admin.ts`, `src/modules/admin/admin.test.ts`

**Interfaces:**
- Produces: `NotificationRecord.idempotencyKey: string | null`; `CreateNotificationInput.idempotencyKey: string`; `Database.notifications.create(input): Promise<{ record: NotificationRecord; created: boolean }>`; `notify(deps, userId, template, payload, eventKey: string): Promise<void>` — consumed by Tasks 2-4 and by every future `notify()` caller.
- Consumes: existing `notify`, `Database.notifications`, `applyTransition` idempotency keys (`request:{id}:accept|decline|expire`, `review:{requestId}:{idempotencyKey}`).

- [ ] **Step 1: Write the failing tests (fake DB layer)**

In `src/adapters/db/fake.test.ts`, in the existing `describe("createFakeDatabase notifications", …)` block, update the three existing tests to the new signature (`create` now takes `idempotencyKey` and returns `{ record, created }`), i.e. every `const record = await db.notifications.create({ userId: user.id, template: "request.accepted", payload: {} });` becomes:

```ts
const { record } = await db.notifications.create({
  userId: user.id,
  template: "request.accepted",
  payload: {},
  idempotencyKey: "test:k1",
});
```
(use a distinct key per test; keep the rest of each test's assertions). Then add these tests to that block:

```ts
  it("create returns created=true and the record for a new idempotency key", async () => {
    const { db } = createFakeDatabase();
    const user = await db.identity.findOrCreateUser("fb-idem-1", "idem1@x.com", "seeker");
    const result = await db.notifications.create({
      userId: user.id,
      template: "request.accepted",
      payload: { a: 1 },
      idempotencyKey: "evt:1:request.accepted:u",
    });
    expect(result.created).toBe(true);
    expect(result.record.idempotencyKey).toBe("evt:1:request.accepted:u");
    expect(result.record.status).toBe("pending");
  });

  it("create with an existing idempotency key returns the original record with created=false and adds no row", async () => {
    const { db } = createFakeDatabase();
    const user = await db.identity.findOrCreateUser("fb-idem-2", "idem2@x.com", "seeker");
    const first = await db.notifications.create({
      userId: user.id,
      template: "request.accepted",
      payload: { a: 1 },
      idempotencyKey: "evt:2:request.accepted:u",
    });
    const second = await db.notifications.create({
      userId: user.id,
      template: "request.accepted",
      payload: { a: 2 },
      idempotencyKey: "evt:2:request.accepted:u",
    });
    expect(second.created).toBe(false);
    expect(second.record.id).toBe(first.record.id);
    expect(second.record.payload).toEqual({ a: 1 });
  });
```

- [ ] **Step 2: Run to verify RED**

Run: `npx vitest run src/adapters/db/fake.test.ts`
Expected: FAIL (type/shape errors: `create` does not accept `idempotencyKey` / return `{ record, created }`).

- [ ] **Step 3: Schema, types, fake, real**

`drizzle/schema.ts` — in the `notifications` table add the column and a unique index:

```ts
    idempotencyKey: text("idempotency_key"),
```
(place it after `error`), and in the table's index block add:
```ts
    idempotencyKeyUq: uniqueIndex("notifications_idempotency_key_uq").on(table.idempotencyKey),
```
(import `uniqueIndex` from `drizzle-orm/pg-core` if it is not already imported — check the file's existing import list first.) The column is nullable on purpose (additive migration; Postgres allows many NULLs in a unique index).

`src/adapters/db/types.ts`:
```ts
export interface NotificationRecord {
  id: string;
  userId: string;
  template: string;
  payload: unknown;
  status: NotificationStatus;
  channel: NotificationChannel | null;
  deliveredAt: Date | null;
  error: string | null;
  idempotencyKey: string | null;
  createdAt: Date;
}

export interface CreateNotificationInput {
  userId: string;
  template: string;
  payload: unknown;
  idempotencyKey: string;
}
```
and in `Database.notifications`:
```ts
    create(input: CreateNotificationInput): Promise<{ record: NotificationRecord; created: boolean }>;
```

`src/adapters/db/fake.ts` — replace `notifications.create` with:
```ts
      async create(input) {
        const existing = notificationRows.find((n) => n.idempotencyKey === input.idempotencyKey);
        if (existing) return { record: existing, created: false };
        const record: NotificationRecord = {
          id: genId(),
          userId: input.userId,
          template: input.template,
          payload: input.payload,
          status: "pending",
          channel: null,
          deliveredAt: null,
          error: null,
          idempotencyKey: input.idempotencyKey,
          createdAt: new Date(),
        };
        notificationRows.push(record);
        return { record, created: true };
      },
```

`src/adapters/db/real.ts` — replace `notifications.create` with:
```ts
      async create(input) {
        const [inserted] = await db
          .insert(notifications)
          .values({
            userId: input.userId,
            template: input.template,
            payload: input.payload,
            idempotencyKey: input.idempotencyKey,
          })
          .onConflictDoNothing({ target: notifications.idempotencyKey })
          .returning();
        if (inserted) return { record: inserted as NotificationRecord, created: true };
        const [existing] = await db
          .select()
          .from(notifications)
          .where(eq(notifications.idempotencyKey, input.idempotencyKey));
        if (!existing) {
          throw new Error(`Notification with idempotency key ${input.idempotencyKey} vanished after a conflict`);
        }
        return { record: existing as NotificationRecord, created: false };
      },
```

- [ ] **Step 4: Generate migration 0010 and inspect it**

Run: `npm run db:generate -- --name notifications_idempotency_key`
Open the new `drizzle/migrations/0010_notifications_idempotency_key.sql` and confirm it contains ONLY: `ALTER TABLE "notifications" ADD COLUMN "idempotency_key" text;` and `CREATE UNIQUE INDEX "notifications_idempotency_key_uq" ON "notifications" USING btree ("idempotency_key");`. If it contains anything else (drops, rewrites, other tables), stop and report — do not commit it. Confirm `drizzle/migrations/meta/_journal.json` gained one entry after idx 9 and a `0010_snapshot.json` exists.

- [ ] **Step 5: Update `notify()` and its tests**

In `src/modules/notifications/notifications.test.ts`:
- Every direct call `notify({ db, queue }, userId, template, payload)` gains a fifth argument, a distinct event key string (e.g. `"evt:n1"`).
- Every place a test seeds a row with `db.notifications.create({...})` gains `idempotencyKey: "seed:<unique>"` and destructures `{ record }`.
- Add these tests inside `describe("notify", …)`:

```ts
  it("does not create a second row or enqueue a second job for the same event, template and user", async () => {
    const { db } = createFakeDatabase();
    const user = await db.identity.findOrCreateUser("fb-n-dup", "ndup@x.com", "seeker");
    const sent: string[] = [];
    const spyQueue: QueueClient = {
      async start() {},
      async stop() {},
      async send(queueName) {
        sent.push(queueName);
        return "job";
      },
      async work() {},
      async schedule() {},
    };
    const payload = { requestId: "r1", companyName: "Acme" };
    await notify({ db, queue: spyQueue }, user.id, "request.accepted", payload, "request:r1:accept");
    await notify({ db, queue: spyQueue }, user.id, "request.accepted", payload, "request:r1:accept");
    expect(sent.filter((q) => q === "notify.send")).toHaveLength(1);
  });

  it("notifies two different recipients of the same event and template", async () => {
    const { db } = createFakeDatabase();
    const a = await db.identity.findOrCreateUser("fb-n-a", "na@x.com", "seeker");
    const b = await db.identity.findOrCreateUser("fb-n-b", "nb@x.com", "seeker");
    const sent: string[] = [];
    const spyQueue: QueueClient = {
      async start() {},
      async stop() {},
      async send(queueName) {
        sent.push(queueName);
        return "job";
      },
      async work() {},
      async schedule() {},
    };
    const payload = { requestId: "r1", companyName: "Acme", audience: "seeker" };
    await notify({ db, queue: spyQueue }, a.id, "proof.verified", payload, "review:r1:k1");
    await notify({ db, queue: spyQueue }, b.id, "proof.verified", payload, "review:r1:k1");
    expect(sent.filter((q) => q === "notify.send")).toHaveLength(2);
  });
```

In `src/modules/notifications/notifications.ts` replace `notify` with:
```ts
export async function notify(
  deps: NotifyDeps,
  userId: string,
  template: TemplateName,
  payload: unknown,
  eventKey: string
): Promise<void> {
  const definition = templates[template];
  const parsedPayload = definition.payloadSchema.parse(payload);
  const { record, created } = await deps.db.notifications.create({
    userId,
    template,
    payload: parsedPayload,
    idempotencyKey: `${eventKey}:${template}:${userId}`,
  });
  // A replayed event (e.g. a racing second caller of the same transition) finds
  // the row already exists; it must not enqueue a second delivery. A row whose
  // first enqueue failed is re-enqueued by sweepPendingNotifications.
  if (!created) return;
  await deps.queue.send(
    "notify.send",
    { notificationId: record.id },
    { singletonKey: `notify:${record.id}`, retryLimit: 3, retryBackoff: true }
  );
}
```
(Task 2 extracts the enqueue into a shared helper; leave the inline `send` here.)

- [ ] **Step 6: Pass the event key at every call site, with replay tests**

`src/modules/requests/requests.ts`: the three `notify(deps, seekerProfile.userId, "<template>", {...})` calls (accept, decline, expire) each gain a fifth argument equal to the transition's own idempotency key string already used in that function: `` `request:${requestId}:accept` ``, `` `request:${requestId}:decline` ``, `` `request:${requestId}:expire` ``. Do not change anything else in these functions.

`src/modules/admin/admin.ts`: in `reviewProof`, hoist the transition key into a constant `const transitionKey = \`review:${input.requestId}:${input.idempotencyKey}\`;`, use it for `applyTransition`'s `idempotencyKey`, and pass it as a new fourth-after-`deps` parameter to `notifyOrLog(deps, userId, template, payload, eventKey)` which forwards it as `notify(...)`'s fifth argument. Update the three `notifyOrLog(...)` calls to pass `transitionKey`.

Add to `src/modules/requests/requests.test.ts` (reuse the file's existing helpers, e.g. `makeVerifiedInsiderAndFundedSeeker` and its `RULES_VALUE`; the queue spy pattern already exists in the file — follow it):

```ts
  it("does not send a second notification when a racing caller replays the same accept", async () => {
    const { deps, seekerProfileId, insiderProfileId } = await makeVerifiedInsiderAndFundedSeeker(5);
    const sends: string[] = [];
    const spyQueue: QueueClient = {
      ...deps.queue,
      async send(queueName, payload, options) {
        sends.push(queueName);
        return deps.queue.send(queueName, payload, options);
      },
    };
    const spyDeps = { db: deps.db, queue: spyQueue };
    const request = await sendRequest(spyDeps, { idempotencyKey: "k-replay-accept", seekerProfileId, insiderProfileId });
    const staleSnapshot = await deps.db.requests.getById(request.id); // still SENT

    await accept(spyDeps, request.id);

    // Second caller read the request before the first committed, so it passes
    // the state check and reaches applyTransition's idempotent-replay branch.
    const racingDb: Database = {
      ...deps.db,
      requests: { ...deps.db.requests, getById: async () => staleSnapshot },
    };
    const replayed = await accept({ db: racingDb, queue: spyQueue }, request.id);

    expect(replayed.state).toBe("ACCEPTED");
    expect(sends.filter((q) => q === "notify.send")).toHaveLength(1);
  });
```
Add the analogous test to `src/modules/admin/admin.test.ts` for `reviewProof` verify (same stale-snapshot technique: capture `getById` before the first `reviewProof`, then call `reviewProof` again with the same `idempotencyKey` through a db wrapper returning the stale snapshot) asserting that the total `notify.send` count after the replay equals the count after the first call (2 for verify: Insider + Seeker). Reuse that file's existing setup helpers and queue-spy style.

- [ ] **Step 7: Verify**

Run the focused files while iterating: `npx vitest run src/adapters/db/fake.test.ts src/modules/notifications/notifications.test.ts src/modules/requests/requests.test.ts src/modules/admin/admin.test.ts`. Then once: `npm run lint && npm run typecheck && npm test`.
Expected: all pass, lint 0 problems. The two new replay tests must be shown RED first by temporarily making `notify` ignore `created` (do not commit that) or by running them before Step 5's `if (!created) return;`.

- [ ] **Step 8: Commit**

```bash
git add drizzle src/adapters/db src/modules/notifications src/modules/requests src/modules/admin
git commit -m "feat(notifications): derive notification idempotency from the triggering event"
```

---

## Task 2: Sweep pending notifications whose enqueue was lost

**Files:**
- Modify: `src/adapters/db/types.ts`, `src/adapters/db/fake.ts`, `src/adapters/db/real.ts`, `src/adapters/db/fake.test.ts`
- Modify: `src/modules/notifications/notifications.ts`, `src/modules/notifications/notifications.test.ts`
- Modify: `src/jobs/worker.ts`, `src/jobs/worker.test.ts`

**Interfaces:**
- Consumes: Task 1's `notify`, `Database.notifications.create` returning `{ record, created }`, `NotifyDeps`.
- Produces: `Database.notifications.listPendingOlderThan(cutoff: Date, limit: number): Promise<NotificationRecord[]>`; exports `PENDING_SWEEP_AGE_MS`, `PENDING_SWEEP_BATCH`, `sweepPendingNotifications(deps: NotifyDeps, now: Date): Promise<number>` (returns how many rows were re-enqueued); worker queue `notifications.sweep` on cron `*/15 * * * *`.

- [ ] **Step 1: Failing tests**

`src/adapters/db/fake.test.ts` (notifications block):
```ts
  it("listPendingOlderThan returns only pending rows created before the cutoff, oldest first, up to the limit", async () => {
    const { db } = createFakeDatabase();
    const user = await db.identity.findOrCreateUser("fb-lp-1", "lp1@x.com", "seeker");
    const a = await db.notifications.create({ userId: user.id, template: "request.accepted", payload: {}, idempotencyKey: "lp:a" });
    const b = await db.notifications.create({ userId: user.id, template: "request.accepted", payload: {}, idempotencyKey: "lp:b" });
    const c = await db.notifications.create({ userId: user.id, template: "request.accepted", payload: {}, idempotencyKey: "lp:c" });
    await db.notifications.markSent(b.record.id, "email", new Date());
    const future = new Date(Date.now() + 60_000);
    const past = new Date(Date.now() - 60_000);

    const all = await db.notifications.listPendingOlderThan(future, 10);
    expect(all.map((n) => n.id)).toEqual([a.record.id, c.record.id]);
    expect(await db.notifications.listPendingOlderThan(past, 10)).toEqual([]);
    expect((await db.notifications.listPendingOlderThan(future, 1)).map((n) => n.id)).toEqual([a.record.id]);
  });
```
`src/modules/notifications/notifications.test.ts` — new `describe("sweepPendingNotifications", …)` importing `sweepPendingNotifications, PENDING_SWEEP_AGE_MS` from `./notifications`:
```ts
describe("sweepPendingNotifications", () => {
  function makeSpyQueue(failFor?: (notificationId: string) => boolean) {
    const sent: Array<{ notificationId: string; options?: { singletonKey?: string; retryLimit?: number; retryBackoff?: boolean } }> = [];
    const queue: QueueClient = {
      async start() {},
      async stop() {},
      async send(_queueName, payload, options) {
        const { notificationId } = payload as { notificationId: string };
        if (failFor?.(notificationId)) throw new Error("queue down");
        sent.push({ notificationId, options });
        return "job";
      },
      async work() {},
      async schedule() {},
    };
    return { queue, sent };
  }

  it("re-enqueues pending rows older than the sweep age with the standard singleton key and retry options", async () => {
    const { db } = createFakeDatabase();
    const user = await db.identity.findOrCreateUser("fb-sw-1", "sw1@x.com", "seeker");
    const { record } = await db.notifications.create({ userId: user.id, template: "request.accepted", payload: {}, idempotencyKey: "sw:1" });
    const { queue, sent } = makeSpyQueue();

    const count = await sweepPendingNotifications({ db, queue }, new Date(Date.now() + PENDING_SWEEP_AGE_MS + 1000));

    expect(count).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].notificationId).toBe(record.id);
    expect(sent[0].options?.singletonKey).toBe(`notify:${record.id}`);
    expect(sent[0].options?.retryLimit).toBe(3);
    expect(sent[0].options?.retryBackoff).toBe(true);
  });

  it("does not touch a pending row younger than the sweep age", async () => {
    const { db } = createFakeDatabase();
    const user = await db.identity.findOrCreateUser("fb-sw-2", "sw2@x.com", "seeker");
    await db.notifications.create({ userId: user.id, template: "request.accepted", payload: {}, idempotencyKey: "sw:2" });
    const { queue, sent } = makeSpyQueue();
    expect(await sweepPendingNotifications({ db, queue }, new Date())).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("does not re-enqueue rows that are already sent or failed", async () => {
    const { db } = createFakeDatabase();
    const user = await db.identity.findOrCreateUser("fb-sw-3", "sw3@x.com", "seeker");
    const s = await db.notifications.create({ userId: user.id, template: "request.accepted", payload: {}, idempotencyKey: "sw:3s" });
    const f = await db.notifications.create({ userId: user.id, template: "request.accepted", payload: {}, idempotencyKey: "sw:3f" });
    await db.notifications.markSent(s.record.id, "email", new Date());
    await db.notifications.markFailed(f.record.id, "boom");
    const { queue, sent } = makeSpyQueue();
    expect(await sweepPendingNotifications({ db, queue }, new Date(Date.now() + PENDING_SWEEP_AGE_MS + 1000))).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("keeps sweeping the remaining rows when the queue fails for one of them", async () => {
    const { db } = createFakeDatabase();
    const user = await db.identity.findOrCreateUser("fb-sw-4", "sw4@x.com", "seeker");
    const first = await db.notifications.create({ userId: user.id, template: "request.accepted", payload: {}, idempotencyKey: "sw:4a" });
    const second = await db.notifications.create({ userId: user.id, template: "request.accepted", payload: {}, idempotencyKey: "sw:4b" });
    const { queue, sent } = makeSpyQueue((id) => id === first.record.id);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const count = await sweepPendingNotifications({ db, queue }, new Date(Date.now() + PENDING_SWEEP_AGE_MS + 1000));

    expect(count).toBe(1);
    expect(sent.map((s) => s.notificationId)).toEqual([second.record.id]);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
```
`src/jobs/worker.test.ts`: add a test in the existing style that (a) after `startWorker`, a handler is registered for `"notifications.sweep"`, and (b) invoking it re-enqueues a stale pending row. Follow how the existing `notify.send` / `requests.sweep` worker tests obtain `handlers` from the fake queue and seed rows; to make a row stale, the handler runs with the real clock so instead seed the row then assert only registration plus that the handler runs without error and returns nothing for a fresh row (age gate proven in the module tests). Also assert `queue.schedule` was called for `"notifications.sweep"` with cron `"*/15 * * * *"` if the fake queue records schedules (check `queue.fake.ts`; if it does not expose schedules, assert only the handler registration).

- [ ] **Step 2: Run to verify RED**

`npx vitest run src/adapters/db/fake.test.ts src/modules/notifications/notifications.test.ts src/jobs/worker.test.ts` — expect FAIL (missing `listPendingOlderThan`, `sweepPendingNotifications`, handler).

- [ ] **Step 3: DB layer**

`types.ts`, `Database.notifications`: add
```ts
    listPendingOlderThan(cutoff: Date, limit: number): Promise<NotificationRecord[]>;
```
`fake.ts`:
```ts
      async listPendingOlderThan(cutoff, limit) {
        return notificationRows
          .filter((n) => n.status === "pending" && n.createdAt.getTime() < cutoff.getTime())
          .sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())
          .slice(0, limit);
      },
```
`real.ts` (add `lt` and `asc` to the existing `drizzle-orm` import list):
```ts
      async listPendingOlderThan(cutoff, limit) {
        const rows = await db
          .select()
          .from(notifications)
          .where(and(eq(notifications.status, "pending"), lt(notifications.createdAt, cutoff)))
          .orderBy(asc(notifications.createdAt))
          .limit(limit);
        return rows as NotificationRecord[];
      },
```
Note: the fake sorts oldest-first with `createdAt`; two rows created in the same millisecond keep insertion order (Array.sort is stable).

- [ ] **Step 4: Module code**

In `src/modules/notifications/notifications.ts` add, and make `notify` use the shared helper (replace its inline `deps.queue.send(...)`):
```ts
export const PENDING_SWEEP_AGE_MS = 30 * 60 * 1000;
export const PENDING_SWEEP_BATCH = 100;

async function enqueueDelivery(queue: QueueClient, notificationId: string): Promise<void> {
  await queue.send(
    "notify.send",
    { notificationId },
    { singletonKey: `notify:${notificationId}`, retryLimit: 3, retryBackoff: true }
  );
}

// Re-enqueues delivery for rows still `pending` after PENDING_SWEEP_AGE_MS: the
// row was written but queue.send failed (or the job was lost). Safe to run
// repeatedly: deliverNotification skips rows that are already `sent`, and the
// age gate keeps this away from rows whose first job is still running/retrying.
export async function sweepPendingNotifications(deps: NotifyDeps, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - PENDING_SWEEP_AGE_MS);
  const stale = await deps.db.notifications.listPendingOlderThan(cutoff, PENDING_SWEEP_BATCH);
  let requeued = 0;
  for (const record of stale) {
    try {
      await enqueueDelivery(deps.queue, record.id);
      requeued++;
    } catch (err) {
      console.error(`[notifications] failed to re-enqueue pending notification ${record.id}`, err);
    }
  }
  return requeued;
}
```
and in `notify`, after `if (!created) return;` call `await enqueueDelivery(deps.queue, record.id);`.

`src/jobs/worker.ts`: import `sweepPendingNotifications` from `../modules/notifications/notifications`; after the `notify.send` registration add:
```ts
  await deps.queue.work("notifications.sweep", async () => {
    await sweepPendingNotifications({ db: deps.db, queue: deps.queue }, new Date());
  });
  await deps.queue.schedule("notifications.sweep", "*/15 * * * *", {});
```
and update the final `console.log` to list the four handlers.

- [ ] **Step 5: Verify and commit**

Focused tests green, then once `npm run lint && npm run typecheck && npm test`.
```bash
git add src
git commit -m "feat(notifications): sweep pending notifications whose enqueue was lost"
```

---

## Task 3: Delivery failure bookkeeping

**Files:**
- Modify: `src/modules/notifications/notifications.ts`, `src/modules/notifications/notifications.test.ts`

**Interfaces:**
- Consumes: Task 1/2 code; `TemplateDefinition`, `templates`, `TemplateName` from `./templates`; `Database.notifications.markFailed`.
- Produces: unchanged signature `deliverNotification(deps, notificationId): Promise<void>`; new behaviour: deterministic failures → row `failed`, `console.error`, return (no throw); all-channels-fail → row `failed` with every attempted channel's cause, then throw as before.

- [ ] **Step 1: Failing tests** (in `describe("deliverNotification", …)`; reuse the file's existing helpers for making deps/rows; check how the fake WhatsApp gateway's `setSessionSendFailure` / `setTemplateSendFailure` / `setActiveSession` take arguments and what message they throw, and adapt the expected substrings to those real messages)

```ts
  it("marks the row failed and returns without throwing when the recipient user no longer exists", async () => {
    const { db } = createFakeDatabase();
    const { record } = await db.notifications.create({
      userId: "00000000-0000-0000-0000-000000000000",
      template: "request.accepted",
      payload: { requestId: "r1", companyName: "Acme" },
      idempotencyKey: "df:nouser",
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      deliverNotification({ db, email: createFakeEmailSender().sender, whatsapp: createFakeWhatsAppGateway() }, record.id)
    ).resolves.toBeUndefined();
    const after = await db.notifications.getById(record.id);
    expect(after?.status).toBe("failed");
    expect(after?.error).toContain("not found");
    errorSpy.mockRestore();
  });

  it("marks the row failed and returns without throwing for an unknown template", async () => {
    const { db } = createFakeDatabase();
    const user = await db.identity.findOrCreateUser("fb-df-tpl", "dftpl@x.com", "seeker");
    const { record } = await db.notifications.create({ userId: user.id, template: "not.a.template", payload: {}, idempotencyKey: "df:tpl" });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      deliverNotification({ db, email: createFakeEmailSender().sender, whatsapp: createFakeWhatsAppGateway() }, record.id)
    ).resolves.toBeUndefined();
    const after = await db.notifications.getById(record.id);
    expect(after?.status).toBe("failed");
    expect(after?.error).toContain("not.a.template");
    errorSpy.mockRestore();
  });

  it("marks the row failed and returns without throwing when the stored payload no longer matches its template", async () => {
    const { db } = createFakeDatabase();
    const user = await db.identity.findOrCreateUser("fb-df-pl", "dfpl@x.com", "seeker");
    const { record } = await db.notifications.create({ userId: user.id, template: "request.accepted", payload: { wrong: true }, idempotencyKey: "df:pl" });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      deliverNotification({ db, email: createFakeEmailSender().sender, whatsapp: createFakeWhatsAppGateway() }, record.id)
    ).resolves.toBeUndefined();
    const after = await db.notifications.getById(record.id);
    expect(after?.status).toBe("failed");
    expect(after?.error).toContain("request.accepted");
    errorSpy.mockRestore();
  });

  it("records every attempted channel's failure cause when all channels fail, and still throws", async () => {
    const { db } = createFakeDatabase();
    const user = await db.identity.findOrCreateUser("fb-df-all", "dfall@x.com", "seeker");
    await db.identity.setUserPhone(user.id, "+919999900001");
    const { record } = await db.notifications.create({
      userId: user.id,
      template: "request.accepted",
      payload: { requestId: "r1", companyName: "Acme" },
      idempotencyKey: "df:all",
    });
    const whatsapp = createFakeWhatsAppGateway();
    whatsapp.setActiveSession(user.id, true);
    whatsapp.setSessionSendFailure("+919999900001", true);
    whatsapp.setTemplateSendFailure("+919999900001", true);
    const failingEmail: EmailSender = { async send() { throw new Error("Brevo is down"); } };

    await expect(deliverNotification({ db, email: failingEmail, whatsapp }, record.id)).rejects.toThrow();

    const after = await db.notifications.getById(record.id);
    expect(after?.status).toBe("failed");
    expect(after?.error).toContain("whatsapp_session");
    expect(after?.error).toContain("whatsapp_template");
    expect(after?.error).toContain("email: Brevo is down");
  });
```
Adjust imports at the top of the test file (`EmailSender` type from `../../adapters/email/types`, etc.) and adapt the fake WhatsApp calls to their real signatures. If existing tests assert that a missing user or unknown/invalid payload *throws*, update them to the new contract (resolves + row `failed`).

- [ ] **Step 2: Run to verify RED** — `npx vitest run src/modules/notifications/notifications.test.ts`; the four new tests fail for the right reasons.

- [ ] **Step 3: Implement** — replace `deliverNotification` in `src/modules/notifications/notifications.ts` with (import `type TemplateDefinition` from `./templates` alongside `templates, TemplateName`):
```ts
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function deliverNotification(deps: DeliveryDeps, notificationId: string): Promise<void> {
  const record = await deps.db.notifications.getById(notificationId);
  if (!record) throw new NotificationNotFoundError(notificationId);
  if (record.status === "sent") return;

  // Failures below are deterministic: retrying cannot fix them, so record the
  // reason on the row and return instead of letting pg-boss retry forever.
  const failPermanently = async (reason: string): Promise<void> => {
    console.error(`[notifications] ${reason}`);
    await deps.db.notifications.markFailed(notificationId, reason);
  };

  const user = await deps.db.identity.getUserById(record.userId);
  if (!user) {
    await failPermanently(`User ${record.userId} not found for notification ${notificationId}`);
    return;
  }

  const definition: TemplateDefinition | undefined = templates[record.template as TemplateName];
  if (!definition) {
    await failPermanently(`Unknown template "${record.template}" on notification ${notificationId}`);
    return;
  }
  const parsed = definition.payloadSchema.safeParse(record.payload);
  if (!parsed.success) {
    await failPermanently(
      `Stored payload no longer matches template "${record.template}" on notification ${notificationId}: ${parsed.error.message}`
    );
    return;
  }
  const payload = parsed.data;

  let channel: NotificationChannel | null = null;
  const attempts: string[] = [];

  if (user.phone) {
    try {
      const hasSession = await deps.whatsapp.hasActiveSession(record.userId);
      if (hasSession) {
        await deps.whatsapp.sendSessionMessage(user.phone, definition.renderWhatsAppText(payload));
        channel = "whatsapp_session";
      }
    } catch (err) {
      attempts.push(`whatsapp_session: ${errorMessage(err)}`);
    }

    if (!channel) {
      try {
        await deps.whatsapp.sendTemplateMessage(
          user.phone,
          definition.whatsappTemplateName,
          definition.whatsappParams(payload)
        );
        channel = "whatsapp_template";
      } catch (err) {
        attempts.push(`whatsapp_template: ${errorMessage(err)}`);
      }
    }
  }

  if (!channel) {
    try {
      const rendered = definition.renderEmail(payload);
      await deps.email.send({ to: user.email, subject: rendered.subject, html: rendered.html });
      channel = "email";
    } catch (err) {
      const message = [...attempts, `email: ${errorMessage(err)}`].join("; ");
      await deps.db.notifications.markFailed(notificationId, message);
      throw new Error(`Failed to deliver notification ${notificationId} on any channel: ${message}`);
    }
  }

  await deps.db.notifications.markSent(notificationId, channel, new Date());
}
```
If TypeScript objects to `safeParse`/`parse` typing on the `TemplateDefinition` union, fix the typing minimally (e.g. a narrower cast local to this function); do not change `templates.ts`.

- [ ] **Step 4: Verify and commit** — focused tests, then once `npm run lint && npm run typecheck && npm test`.
```bash
git add src/modules/notifications
git commit -m "fix(notifications): record delivery failures on the row instead of retrying deterministic ones"
```

---

## Task 4: Live-Postgres integration test (guarded)

**Files:**
- Create: `src/modules/notifications/notifications.live.test.ts`

**Interfaces:**
- Consumes: real `Database` (`createRealDatabase(drizzle(new Pool(...)))`), real queue (`createRealQueueClient`), migrations 0000-0010 applied to the DB in `DATABASE_URL`.
- Produces: an opt-in test (`RUN_VENDOR_TESTS=1`) covering the real-adapter behaviour the fakes cannot prove; skipped in the normal `npm test`.

- [ ] **Step 1: Write the test**

```ts
// @vitest-environment node
// Live test against a real Postgres (dev compose). Skipped unless RUN_VENDOR_TESTS=1.
// Run: export $(grep -v '^#' .env.local | xargs -d '\n'); npm run db:migrate;
//      RUN_VENDOR_TESTS=1 npx vitest run src/modules/notifications/notifications.live.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { createRealDatabase } from "../../adapters/db/real";
import { createRealQueueClient } from "../../jobs/queue.real";
import type { Database } from "../../adapters/db/types";

const live = process.env.RUN_VENDOR_TESTS === "1";

describe.skipIf(!live)("notifications against real Postgres and pg-boss", () => {
  const tag = Date.now().toString(36);
  let pool: Pool;
  let db: Database;
  let userId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = createRealDatabase(drizzle(pool));
    const user = await db.identity.findOrCreateUser(`fb-live-${tag}`, `live-${tag}@x.com`, "seeker");
    userId = user.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("create is idempotent on the key: the second call returns the original row with created=false", async () => {
    const key = `live:${tag}:idem`;
    const first = await db.notifications.create({ userId, template: "request.accepted", payload: { n: 1 }, idempotencyKey: key });
    const second = await db.notifications.create({ userId, template: "request.accepted", payload: { n: 2 }, idempotencyKey: key });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.record.id).toBe(first.record.id);
    expect(second.record.payload).toEqual({ n: 1 });
  });

  it("markSent and markFailed persist status, channel, deliveredAt and error", async () => {
    const sent = await db.notifications.create({ userId, template: "request.accepted", payload: {}, idempotencyKey: `live:${tag}:sent` });
    const when = new Date("2026-09-25T10:00:00.000Z");
    await db.notifications.markSent(sent.record.id, "email", when);
    const afterSent = await db.notifications.getById(sent.record.id);
    expect(afterSent?.status).toBe("sent");
    expect(afterSent?.channel).toBe("email");
    expect(afterSent?.deliveredAt?.toISOString()).toBe(when.toISOString());

    const failed = await db.notifications.create({ userId, template: "request.accepted", payload: {}, idempotencyKey: `live:${tag}:failed` });
    await db.notifications.markFailed(failed.record.id, "all channels failed");
    const afterFailed = await db.notifications.getById(failed.record.id);
    expect(afterFailed?.status).toBe("failed");
    expect(afterFailed?.error).toBe("all channels failed");
  });

  it("listPendingOlderThan returns pending rows before the cutoff, oldest first, and skips sent rows", async () => {
    const pending = await db.notifications.create({ userId, template: "request.accepted", payload: {}, idempotencyKey: `live:${tag}:pending` });
    const future = new Date(Date.now() + 60_000);
    const rows = await db.notifications.listPendingOlderThan(future, 1000);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(pending.record.id);
    expect(rows.every((r) => r.status === "pending")).toBe(true);
    const times = rows.map((r) => r.createdAt.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(await db.notifications.listPendingOlderThan(new Date(Date.now() - 24 * 60 * 60 * 1000), 5)).toEqual(
      rows.filter(() => false)
    );
  });

  it("real pg-boss accepts a send with no retry options and a send with them (regression: undefined option keys)", async () => {
    const queue = createRealQueueClient(process.env.DATABASE_URL as string);
    await queue.start();
    try {
      await expect(queue.send(`live-test-${tag}`, { a: 1 }, { startAfterSeconds: 3600, singletonKey: `live:${tag}:a` })).resolves.toBeTruthy();
      await expect(queue.send(`live-test-${tag}`, { a: 2 }, { singletonKey: `live:${tag}:b`, retryLimit: 3, retryBackoff: true })).resolves.toBeTruthy();
      await expect(queue.send(`live-test-${tag}`, { a: 3 })).resolves.toBeTruthy();
    } finally {
      await queue.stop();
    }
  });
});
```
Simplify the odd last assertion of the `listPendingOlderThan` test if it is not meaningful once you run it (an empty result for a cutoff 24h in the past is only guaranteed on a database with no old pending rows — if the dev DB contains older pending rows this assertion is wrong; replace it with `expect((await db.notifications.listPendingOlderThan(new Date(0), 5)).every((r) => r.createdAt.getTime() < 1)).toBe(true)`-style logic, or simply drop that assertion). Do not leave a test that depends on the dev DB being empty.

- [ ] **Step 2: Run it live**

Docker Desktop must be running with the dev Postgres up (`docker compose -f infra/compose.dev.yml up -d postgres`; the docker CLI is at `C:\Users\dml-anmol\AppData\Local\Programs\DockerDesktop\resources\bin`, not on PATH). Then:
```bash
export $(grep -v '^#' .env.local | grep -v '^$' | xargs -d '\n')
npm run db:migrate
RUN_VENDOR_TESTS=1 npx vitest run src/modules/notifications/notifications.live.test.ts
```
Expected: `db:migrate` applies 0010; the 4 live tests PASS. Paste the real output in the report.

- [ ] **Step 3: Confirm it is skipped by default** — run `npx vitest run src/modules/notifications/notifications.live.test.ts` without `RUN_VENDOR_TESTS`; expect 4 skipped, 0 failed.

- [ ] **Step 4: Verify and commit** — once `npm run lint && npm run typecheck && npm test`.
```bash
git add src/modules/notifications/notifications.live.test.ts
git commit -m "test(notifications): add opt-in live Postgres and pg-boss integration test"
```

---

## Post-tasks (controller)

- Final whole-branch review (opus) against this plan and AGENTS.md; fix Critical/Important in one wave.
- Update the "Final review findings and deferred follow-ups" section of the notifications plan and SESSION-HANDOFF.md §1: mark the hard gate items 1-3 done, state that a live run was performed, note the live-test command, and list what remains before real adapters (Brevo/WhatsApp real implementations, CR/LF subject stripping, fake email growth).
- `finishing-a-development-branch`: merge with a merge commit into `main`, re-run lint/typecheck/tests on `main`, do not push, remove the worktree, delete the branch.
