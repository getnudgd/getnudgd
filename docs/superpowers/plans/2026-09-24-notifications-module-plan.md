# Notifications Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `notify(userId, template, payload)` module that durably records and delivers notifications through a WhatsApp-session vs WhatsApp-template vs email-fallback channel tree, and wire it into the 5 core Insider Request outcome events (accept, decline, expire, proof verified, proof rejected).

**Architecture:** Two-phase design mirroring the `request.expire` pattern from the merged Phase 1 Timers plan. Phase 1 (`notify()`, synchronous): validates the payload, writes a `notifications` row, enqueues a `notify.send` job — called from `requests.ts`/`admin.ts` right after their own DB transition, wrapped in try/catch so a notification hiccup never fails the underlying mutation. Phase 2 (`deliverNotification()`, async, run by the worker): resolves the recipient, runs the channel-selection tree, sends, and records the outcome. WhatsApp is fully designed and stubbed behind a new `WhatsAppGateway` adapter (fake only — real is Phase 2/3 per AGENTS.md's own backlog).

**Tech Stack:** No new dependencies. Reuses this repo's existing Drizzle/Postgres, pg-boss, Zod, and the adapter-interface-plus-fake pattern already established for `EmailSender`/`AuthAdapter`/`StorageAdapter`.

**Spec:** `docs/superpowers/specs/2026-09-24-notifications-module-design.md`

## Global Constraints

- TypeScript strict, no `any`, no `@ts-ignore`; Zod at every boundary (AGENTS.md Part 2.1) — `notify()`'s payload is Zod-validated against the named template's schema before a `notifications` row is ever written.
- Domain modules (`src/modules/notifications`) import no Next.js, no Drizzle client, no vendor SDK — only `Database`/`QueueClient`/`EmailSender`/`WhatsAppGateway` via a `deps` object (Part 2.2).
- Every vendor is behind an interface with a fake (Part 2.3) — `WhatsAppGateway` gets both `types.ts` and a configurable `fake.ts` in the same task; no `real.ts` in this plan (Phase 2/3 work per AGENTS.md §3.11).
- Idempotency on anything that sends a message (Part 2.4) — the `notify.send` job's `singletonKey` is exactly `notify:{notificationId}`, embedding the entity id (this codebase has twice already had bugs from idempotency keys that didn't embed the entity id — don't repeat that).
- Jobs never call each other synchronously; they enqueue (§3.4) — `notify()` enqueues and returns; it never awaits delivery.
- Every job handler is idempotent and re-checks current state before acting (§3.4) — `deliverNotification` reads the notification row's current state fresh each call; delivering an already-`sent` notification a second time is out of scope for this plan (pg-boss's own retry/backoff only re-fires on a thrown error, and a successful delivery never throws).
- Locked vocabulary: Insider, Seeker, Insider Request, vouch, credits, Insider Rewards — never "referrer"/"refer"/"payout" (§0.4). All template copy uses `src/config/brand.ts`'s `brand.name`, never a hardcoded "GetNudgd" string.
- No business number literal (§0.5) — this plan introduces none; `refundedCredits` in notification payloads is computed from `rules.refundPercentOnDecline`/`refundPercentOnExpiry`, already loaded via `getRulesWithVersion`, not a new hardcoded percentage.
- Small, verified commits; run `npm run lint && npm run typecheck && npm test` before every commit (Part 2.10).
- Do not add dependencies (Part 2.11) — none needed.
- No live Postgres is required to execute this plan's tasks (the fake `Database`/`QueueClient`/`EmailSender`/`WhatsAppGateway` cover all module-level tests); verifying `real.ts`'s new methods against a live Postgres is welcome but not required, matching the Phase 1 Timers plan's precedent — **with one exception**: the Phase 1 Timers final review found that a plan's own "fake-only is fine" excusal can silently expire once a change becomes live-reachable. This plan's schema/migration change (Task 3) is not live-reachable by anything until Task 7 wires the worker — so the precedent holds for Tasks 1-6, but Task 7's own verification step must include confirming `npm run db:generate` produced a syntactically sound migration (inspected, not just trusted) even without applying it to a live database.
- Out of scope, explicitly (from the spec): a real `WhatsAppGateway.real.ts`; the literal 15-minute delivery-confirmation-based email fallback (this plan falls back to email immediately on any WhatsApp send failure — there is no webhook yet to wait on); any trigger event beyond the 5 named in the spec; an admin UI for failed notifications; populating `users.phone` from any onboarding flow (the column is added, nothing writes to it yet).

## Review Focus

- **A `notify()` payload that fails its template's Zod schema** — the spec requires this throw synchronously from `notify()` itself (a caller bug), never silently create a row or reach the queue. Task 5's tests pin this.
- **A recipient with no phone on file** — `deliverNotification` must skip both WhatsApp branches entirely and go straight to email, not throw or attempt a WhatsApp send with a null/undefined `to`. Task 5's tests pin this.
- **Every delivery channel failing** — `deliverNotification` must mark the row `failed` with a real error message (not swallow it) and rethrow so pg-boss's retry/backoff actually fires; a silently-swallowed total failure would look identical to a stuck queue from the outside. Task 5's tests pin this.
- **The `RequestsDeps`/`AdminDeps` ripple from adding `queue` to `AdminDeps`** — `AdminDeps` currently has only `db`; every existing bare `{ db }` construction of it (including inside `admin.test.ts`, not just production code) will fail to typecheck once `queue` becomes required, exactly the class of cross-file break the Phase 1 Timers plan already hit once for `RequestsDeps`. Task 6 must find and fix every site, not just the ones it expects.
- **`expire()`'s existing `RequestStateConflictError` fallback path notifying when it shouldn't** — `expire()` already has a concurrent-caller fallback (catch `RequestStateConflictError`, re-fetch, return the current state) from a prior plan. If the new notify-on-expire logic is placed carelessly, a concurrent second caller that hits the conflict-and-return-early path would also send a duplicate "your request expired" notification for a state change it didn't cause. Task 6's `expire()` diff must only notify on the branch that actually performed the transition, and its test must prove the fallback path does not.

---

## Task 1: Extend `SendOptions` with `retryLimit`/`retryBackoff`

**Files:**
- Modify: `src/jobs/queue.ts`
- Modify: `src/jobs/queue.fake.test.ts`
- Modify: `src/jobs/queue.real.ts`

**Interfaces:**
- Produces: `SendOptions.retryLimit?: number`, `SendOptions.retryBackoff?: boolean` — consumed by Task 5's `notify()`.

- [ ] **Step 1: Read the current `SendOptions`/`QueueClient` interface**

`src/jobs/queue.ts` currently reads:
```ts
export interface JobHandler<T = unknown> {
  (payload: T): Promise<void>;
}

export interface SendOptions {
  /**
   * A label for the job. Against the real pg-boss client (queue.real.ts),
   * queues are created under pg-boss's default "standard" policy, under which
   * singletonKey is NOT a uniqueness/dedup constraint — pg-boss will still
   * happily enqueue duplicates with the same key. "Runs once" safety comes
   * from the domain layer's own idempotent state checks (e.g. requests.expire()
   * re-checking the request is still SENT before acting), not from this key.
   */
  singletonKey?: string;
  startAfterSeconds?: number;
}

export interface QueueClient {
  /**
   * Contract: callers must call start() before work(), schedule(), or send()
   * against the real client (queue.real.ts) — pg-boss requires the database
   * connection to already be open before queues can be created/used.
   */
  start(): Promise<void>;
  stop(): Promise<void>;
  send(queueName: string, payload: unknown, options?: SendOptions): Promise<string | null>;
  work(queueName: string, handler: JobHandler): Promise<void>;
  schedule(queueName: string, cron: string, payload: unknown): Promise<void>;
}
```
Replace the `SendOptions` interface with:
```ts
export interface SendOptions {
  /**
   * A label for the job. Against the real pg-boss client (queue.real.ts),
   * queues are created under pg-boss's default "standard" policy, under which
   * singletonKey is NOT a uniqueness/dedup constraint — pg-boss will still
   * happily enqueue duplicates with the same key. "Runs once" safety comes
   * from the domain layer's own idempotent state checks (e.g. requests.expire()
   * re-checking the request is still SENT before acting), not from this key.
   */
  singletonKey?: string;
  startAfterSeconds?: number;
  /** Maximum number of retry attempts pg-boss makes after the first failure. */
  retryLimit?: number;
  /** When true, pg-boss backs off exponentially between retries instead of a fixed delay. */
  retryBackoff?: boolean;
}
```
(Leave `QueueClient` itself unchanged — only `SendOptions` gains fields.)

- [ ] **Step 2: Write the failing test**

Add this test to the existing `describe("createFakeQueueClient", ...)` block in `src/jobs/queue.fake.test.ts` (the file currently has 6 tests — see below for its exact current content; add this as a 7th, after the "accepts SendOptions without erroring..." test):
```ts
  it("accepts retryLimit and retryBackoff in SendOptions without erroring", async () => {
    const queue = createFakeQueueClient();
    const handler = vi.fn(async () => {});
    await queue.start();
    await queue.work("notify.send", handler);
    const jobId = await queue.send(
      "notify.send",
      { notificationId: "n1" },
      { singletonKey: "notify:n1", retryLimit: 3, retryBackoff: true }
    );
    expect(jobId).not.toBeNull();
    expect(handler).toHaveBeenCalledWith({ notificationId: "n1" });
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/jobs/queue.fake.test.ts`
Expected: this specific new test should actually PASS already, since the fake's `send` signature already accepts an untyped `options` object and TypeScript is the only thing that would reject `retryLimit`/`retryBackoff` before Step 1's interface change. Run `npm run typecheck` instead to confirm the FAILURE mode: TypeScript should reject the new test's `retryLimit`/`retryBackoff` fields as excess properties on `SendOptions` before Step 1 lands.
Expected: typecheck FAILS with an excess-property or type error on `retryLimit`/`retryBackoff`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run typecheck` — must now pass (Step 1's interface change makes the new fields legal).
Run: `npx vitest run src/jobs/queue.fake.test.ts` — expect PASS (7 tests: the existing 6 plus the new one).

- [ ] **Step 5: Implement in `src/jobs/queue.real.ts`**

Current file:
```ts
import { PgBoss } from "pg-boss";
import type { QueueClient } from "./queue";

export function createRealQueueClient(connectionString: string): QueueClient {
  const boss = new PgBoss(connectionString);
  return {
    async start() {
      await boss.start();
    },
    async stop() {
      await boss.stop();
    },
    async send(queueName, payload, options) {
      await boss.createQueue(queueName);
      return boss.send(queueName, payload as object, {
        singletonKey: options?.singletonKey,
        startAfter: options?.startAfterSeconds,
      });
    },
    async work(queueName, handler) {
      await boss.createQueue(queueName);
      await boss.work(queueName, async (jobs) => {
        for (const job of jobs) {
          await handler(job.data);
        }
      });
    },
    async schedule(queueName, cron, payload) {
      await boss.createQueue(queueName);
      await boss.schedule(queueName, cron, payload as object);
    },
  };
}
```
Replace the `send` method's pg-boss options object with:
```ts
    async send(queueName, payload, options) {
      await boss.createQueue(queueName);
      return boss.send(queueName, payload as object, {
        singletonKey: options?.singletonKey,
        startAfter: options?.startAfterSeconds,
        retryLimit: options?.retryLimit,
        retryBackoff: options?.retryBackoff,
      });
    },
```
(Leave `start`, `stop`, `work`, `schedule` unchanged. pg-boss's `SendOptions.retryLimit`/`retryBackoff` field names are confirmed present in `node_modules/pg-boss/dist/types.d.ts` — same file Task 1 of the Phase 1 Timers plan already confirmed `singletonKey`/`startAfter` in.)

- [ ] **Step 6: Verify**

Run: `npm run typecheck` — must pass.
Run: `npm run lint` — must be clean.
Run: `npm test` — full suite passes.

- [ ] **Step 7: Commit**

```bash
git add src/jobs/queue.ts src/jobs/queue.fake.test.ts src/jobs/queue.real.ts
git commit -m "feat(jobs): add retryLimit/retryBackoff to QueueClient SendOptions"
```

---

## Task 2: `WhatsAppGateway` adapter — interface and configurable fake

**Files:**
- Create: `src/adapters/whatsapp/types.ts`
- Create: `src/adapters/whatsapp/fake.ts`
- Create: `src/adapters/whatsapp/fake.test.ts`

**Interfaces:**
- Produces: `WhatsAppGateway`, `createFakeWhatsAppGateway()` — consumed by Task 5's `deliverNotification`, Task 6's `worker.ts` tests, Task 7's `worker.ts`/`adapters.impl.ts`.

- [ ] **Step 1: Write the failing test**

Create `src/adapters/whatsapp/fake.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createFakeWhatsAppGateway } from "./fake";

describe("createFakeWhatsAppGateway", () => {
  it("reports no active session by default, and reflects setActiveSession", async () => {
    const { gateway, setActiveSession } = createFakeWhatsAppGateway();
    expect(await gateway.hasActiveSession("user-1")).toBe(false);
    setActiveSession("user-1", true);
    expect(await gateway.hasActiveSession("user-1")).toBe(true);
    setActiveSession("user-1", false);
    expect(await gateway.hasActiveSession("user-1")).toBe(false);
  });

  it("sendSessionMessage records the message and returns a unique id, unless failure is forced", async () => {
    const { gateway, sentSessionMessages, setSessionSendFailure } = createFakeWhatsAppGateway();
    const first = await gateway.sendSessionMessage("+911234567890", "Hello");
    expect(sentSessionMessages).toEqual([{ to: "+911234567890", body: "Hello" }]);
    setSessionSendFailure("+911234567890", true);
    await expect(gateway.sendSessionMessage("+911234567890", "Hello again")).rejects.toThrow();
    setSessionSendFailure("+911234567890", false);
    const second = await gateway.sendSessionMessage("+911234567890", "Hello once more");
    expect(first.id).not.toBe(second.id);
  });

  it("sendTemplateMessage records the message and returns a unique id, unless failure is forced", async () => {
    const { gateway, sentTemplateMessages, setTemplateSendFailure } = createFakeWhatsAppGateway();
    await gateway.sendTemplateMessage("+911234567890", "request_accepted", { companyName: "Acme" });
    expect(sentTemplateMessages).toEqual([
      { to: "+911234567890", templateName: "request_accepted", params: { companyName: "Acme" } },
    ]);
    setTemplateSendFailure("+911234567890", true);
    await expect(
      gateway.sendTemplateMessage("+911234567890", "request_accepted", { companyName: "Acme" })
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/adapters/whatsapp/fake.test.ts`
Expected: FAIL — `./fake` doesn't exist yet.

- [ ] **Step 3: Implement `src/adapters/whatsapp/types.ts`**

```ts
export interface WhatsAppGateway {
  hasActiveSession(userId: string): Promise<boolean>;
  sendSessionMessage(to: string, body: string): Promise<{ id: string }>;
  sendTemplateMessage(to: string, templateName: string, params: Record<string, string>): Promise<{ id: string }>;
}
```

- [ ] **Step 4: Implement `src/adapters/whatsapp/fake.ts`**

```ts
import type { WhatsAppGateway } from "./types";

export interface FakeWhatsAppGateway {
  gateway: WhatsAppGateway;
  setActiveSession(userId: string, active: boolean): void;
  setSessionSendFailure(phone: string, shouldFail: boolean): void;
  setTemplateSendFailure(phone: string, shouldFail: boolean): void;
  sentSessionMessages: Array<{ to: string; body: string }>;
  sentTemplateMessages: Array<{ to: string; templateName: string; params: Record<string, string> }>;
}

export function createFakeWhatsAppGateway(): FakeWhatsAppGateway {
  const activeSessions = new Set<string>();
  const sessionFailures = new Set<string>();
  const templateFailures = new Set<string>();
  const sentSessionMessages: Array<{ to: string; body: string }> = [];
  const sentTemplateMessages: Array<{ to: string; templateName: string; params: Record<string, string> }> = [];

  const gateway: WhatsAppGateway = {
    async hasActiveSession(userId) {
      return activeSessions.has(userId);
    },
    async sendSessionMessage(to, body) {
      if (sessionFailures.has(to)) throw new Error(`Fake WhatsApp session send failed for ${to}`);
      sentSessionMessages.push({ to, body });
      return { id: `fake-wa-session-${sentSessionMessages.length}` };
    },
    async sendTemplateMessage(to, templateName, params) {
      if (templateFailures.has(to)) throw new Error(`Fake WhatsApp template send failed for ${to}`);
      sentTemplateMessages.push({ to, templateName, params });
      return { id: `fake-wa-template-${sentTemplateMessages.length}` };
    },
  };

  return {
    gateway,
    setActiveSession(userId, active) {
      if (active) activeSessions.add(userId);
      else activeSessions.delete(userId);
    },
    setSessionSendFailure(phone, shouldFail) {
      if (shouldFail) sessionFailures.add(phone);
      else sessionFailures.delete(phone);
    },
    setTemplateSendFailure(phone, shouldFail) {
      if (shouldFail) templateFailures.add(phone);
      else templateFailures.delete(phone);
    },
    sentSessionMessages,
    sentTemplateMessages,
  };
}
```
(`setActiveSession` is keyed by `userId`, matching `hasActiveSession(userId)`'s parameter. `setSessionSendFailure`/`setTemplateSendFailure` are keyed by `phone` — the `to` parameter — matching what `sendSessionMessage`/`sendTemplateMessage` actually receive; a test cannot force a failure by `userId` for those two methods since the gateway itself never sees a `userId` at send time, only a phone number.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/adapters/whatsapp/fake.test.ts`
Expected: PASS (3 tests).
Run: `npm run typecheck` and `npm run lint` — both clean.

- [ ] **Step 6: Commit**

```bash
git add src/adapters/whatsapp
git commit -m "feat(adapters): add WhatsAppGateway interface and configurable fake"
```

---

## Task 3: `users.phone`, `notifications` table, and their `Database` methods

**Files:**
- Modify: `drizzle/schema.ts`
- Modify: `src/adapters/db/types.ts`
- Modify: `src/adapters/db/fake.ts`
- Modify: `src/adapters/db/fake.test.ts`
- Modify: `src/adapters/db/real.ts`
- Create: `drizzle/migrations/0009_notifications_and_phone.sql` (generated, not hand-written — see Step 6)

**Interfaces:**
- Produces: `UserRecord.phone: string | null`; `NotificationStatus`, `NotificationChannel`, `NotificationRecord`, `CreateNotificationInput` types; `Database.identity.getSeekerProfileById`, `Database.identity.setUserPhone`; `Database.notifications.{create,getById,markSent,markFailed}` — consumed by Task 5's `notifications.ts`, Task 6's `requests.ts`/`admin.ts`.

- [ ] **Step 1: Write the failing tests**

Add to the existing `describe("createFakeDatabase identity", ...)` block in `src/adapters/db/fake.test.ts` (after the last existing test in that block, "throws when updating a nonexistent insider profile's company"):
```ts
  it("gets a seeker profile by id, and returns null when not found", async () => {
    const { db } = createFakeDatabase();
    const user = await db.identity.findOrCreateUser("fb-gsp1", "gsp1@x.com", "seeker");
    const profile = await db.identity.createSeekerProfile(user.id, "Get Seeker Profile");
    expect((await db.identity.getSeekerProfileById(profile.id))?.fullName).toBe("Get Seeker Profile");
    expect(await db.identity.getSeekerProfileById("nope")).toBeNull();
  });

  it("sets a user's phone, defaulting to null for a newly created user", async () => {
    const { db } = createFakeDatabase();
    const user = await db.identity.findOrCreateUser("fb-phone1", "phone1@x.com", "seeker");
    expect(user.phone).toBeNull();
    await db.identity.setUserPhone(user.id, "+911234567890");
    expect((await db.identity.getUserById(user.id))?.phone).toBe("+911234567890");
  });

  it("throws when setting phone for a nonexistent user", async () => {
    const { db } = createFakeDatabase();
    await expect(db.identity.setUserPhone("nope", "+911234567890")).rejects.toThrow();
  });
```

Add a new top-level `describe` block at the end of the file, after the `describe("createFakeDatabase requests proof and admin review", ...)` block closes:
```ts

describe("createFakeDatabase notifications", () => {
  it("creates a pending notification with no channel and no deliveredAt", async () => {
    const { db } = createFakeDatabase();
    const user = await db.identity.findOrCreateUser("fb-notif1", "notif1@x.com", "seeker");
    const record = await db.notifications.create({
      userId: user.id,
      template: "request.accepted",
      payload: { requestId: "r1", companyName: "Acme" },
    });
    expect(record.status).toBe("pending");
    expect(record.channel).toBeNull();
    expect(record.deliveredAt).toBeNull();
    expect(record.error).toBeNull();
  });

  it("getById returns null for an unknown id", async () => {
    const { db } = createFakeDatabase();
    expect(await db.notifications.getById("nope")).toBeNull();
  });

  it("markSent sets status, channel, and deliveredAt", async () => {
    const { db } = createFakeDatabase();
    const user = await db.identity.findOrCreateUser("fb-notif2", "notif2@x.com", "seeker");
    const record = await db.notifications.create({ userId: user.id, template: "request.accepted", payload: {} });
    const when = new Date();
    await db.notifications.markSent(record.id, "email", when);
    const updated = await db.notifications.getById(record.id);
    expect(updated?.status).toBe("sent");
    expect(updated?.channel).toBe("email");
    expect(updated?.deliveredAt).toEqual(when);
  });

  it("markFailed sets status and error", async () => {
    const { db } = createFakeDatabase();
    const user = await db.identity.findOrCreateUser("fb-notif3", "notif3@x.com", "seeker");
    const record = await db.notifications.create({ userId: user.id, template: "request.accepted", payload: {} });
    await db.notifications.markFailed(record.id, "all channels failed");
    const updated = await db.notifications.getById(record.id);
    expect(updated?.status).toBe("failed");
    expect(updated?.error).toBe("all channels failed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/adapters/db/fake.test.ts`
Expected: FAIL — `db.identity.getSeekerProfileById`, `db.identity.setUserPhone`, and `db.notifications` don't exist yet.

- [ ] **Step 3: Implement in `drizzle/schema.ts`**

The `users` table currently reads:
```ts
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firebaseUid: text("firebase_uid").notNull(),
    email: text("email").notNull(),
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    firebaseUidIdx: uniqueIndex("users_firebase_uid_idx").on(table.firebaseUid),
    emailIdx: uniqueIndex("users_email_idx").on(table.email),
    roleCheck: check("users_role_check", sql`${table.role} in ('seeker','insider','admin','both')`),
  })
);
```
Add a `phone` column (nullable — nothing collects it yet) between `email` and `role`:
```ts
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firebaseUid: text("firebase_uid").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    firebaseUidIdx: uniqueIndex("users_firebase_uid_idx").on(table.firebaseUid),
    emailIdx: uniqueIndex("users_email_idx").on(table.email),
    roleCheck: check("users_role_check", sql`${table.role} in ('seeker','insider','admin','both')`),
  })
);
```

Add a new `notifications` table at the very end of the file, after `adminAuditLog`:
```ts

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    template: text("template").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("pending"),
    channel: text("channel"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusCheck: check("notifications_status_check", sql`${table.status} in ('pending','sent','failed')`),
    channelCheck: check(
      "notifications_channel_check",
      sql`${table.channel} is null or ${table.channel} in ('whatsapp_session','whatsapp_template','email')`
    ),
    userIdIdx: index("notifications_user_id_idx").on(table.userId),
  })
);
```

- [ ] **Step 4: Implement in `src/adapters/db/types.ts`**

`UserRecord` currently reads:
```ts
export interface UserRecord {
  id: string;
  firebaseUid: string;
  email: string;
  role: Role;
  createdAt: Date;
}
```
Add `phone`:
```ts
export interface UserRecord {
  id: string;
  firebaseUid: string;
  email: string;
  phone: string | null;
  role: Role;
  createdAt: Date;
}
```

Add these new types near `AdminAuditLogRecord` (anywhere before the `Database` interface):
```ts
export type NotificationStatus = "pending" | "sent" | "failed";
export type NotificationChannel = "whatsapp_session" | "whatsapp_template" | "email";

export interface NotificationRecord {
  id: string;
  userId: string;
  template: string;
  payload: unknown;
  status: NotificationStatus;
  channel: NotificationChannel | null;
  deliveredAt: Date | null;
  error: string | null;
  createdAt: Date;
}

export interface CreateNotificationInput {
  userId: string;
  template: string;
  payload: unknown;
}
```

In the `Database` interface, `identity` currently ends:
```ts
    getInsiderProfileById(insiderProfileId: string): Promise<InsiderProfileRecord | null>;
    setUserRole(userId: string, role: Role): Promise<UserRecord>;
  };
```
Change to:
```ts
    getInsiderProfileById(insiderProfileId: string): Promise<InsiderProfileRecord | null>;
    getSeekerProfileById(seekerProfileId: string): Promise<SeekerProfileRecord | null>;
    setUserRole(userId: string, role: Role): Promise<UserRecord>;
    setUserPhone(userId: string, phone: string): Promise<void>;
  };
```

After the `requests: { ... };` block closes and before the final `}` that closes the `Database` interface, add:
```ts
  notifications: {
    create(input: CreateNotificationInput): Promise<NotificationRecord>;
    getById(id: string): Promise<NotificationRecord | null>;
    markSent(id: string, channel: NotificationChannel, deliveredAt: Date): Promise<void>;
    markFailed(id: string, error: string): Promise<void>;
  };
```

- [ ] **Step 5: Implement in `src/adapters/db/fake.ts`**

Add `NotificationRecord` and `NotificationChannel` to the import list at the top of the file (which currently ends with `AdminAuditLogRecord,`):
```ts
  AdminAuditLogRecord,
  NotificationRecord,
  NotificationChannel,
} from "./types";
```

Add a new array near the other row arrays (after `const adminAuditLogRows: AdminAuditLogRecord[] = [];`):
```ts
  const notificationRows: NotificationRecord[] = [];
```

`findOrCreateUser` currently reads:
```ts
      async findOrCreateUser(firebaseUid: string, email: string, role: Role) {
        let user = users.find((u) => u.firebaseUid === firebaseUid);
        if (!user) {
          user = { id: genId(), firebaseUid, email, role, createdAt: new Date() };
          users.push(user);
        }
        return user;
      },
```
Add `phone: null` to the created record:
```ts
      async findOrCreateUser(firebaseUid: string, email: string, role: Role) {
        let user = users.find((u) => u.firebaseUid === firebaseUid);
        if (!user) {
          user = { id: genId(), firebaseUid, email, phone: null, role, createdAt: new Date() };
          users.push(user);
        }
        return user;
      },
```

Immediately after the existing `getInsiderProfileById` method, add:
```ts
      async getSeekerProfileById(seekerProfileId: string) {
        return seekerProfiles.find((p) => p.id === seekerProfileId) ?? null;
      },
```

Immediately after the existing `setUserRole` method (the last method in the `identity` block, right before its closing `},`), add:
```ts
      async setUserPhone(userId: string, phone: string) {
        const user = users.find((u) => u.id === userId);
        if (!user) throw new Error(`User ${userId} not found`);
        user.phone = phone;
      },
```

Immediately after the `requests: { ... }` block's closing `},` (i.e. right before the `};` that closes the `db` object literal), add a new top-level sub-object:
```ts
    notifications: {
      async create(input) {
        const record: NotificationRecord = {
          id: genId(),
          userId: input.userId,
          template: input.template,
          payload: input.payload,
          status: "pending",
          channel: null,
          deliveredAt: null,
          error: null,
          createdAt: new Date(),
        };
        notificationRows.push(record);
        return record;
      },
      async getById(id) {
        return notificationRows.find((n) => n.id === id) ?? null;
      },
      async markSent(id, channel, deliveredAt) {
        const record = notificationRows.find((n) => n.id === id);
        if (!record) throw new Error(`Notification ${id} not found`);
        record.status = "sent";
        record.channel = channel;
        record.deliveredAt = deliveredAt;
      },
      async markFailed(id, error) {
        const record = notificationRows.find((n) => n.id === id);
        if (!record) throw new Error(`Notification ${id} not found`);
        record.status = "failed";
        record.error = error;
      },
    },
```
(`NotificationChannel` is used implicitly via the `markSent` parameter's inferred type from the `Database` interface — no explicit local annotation needed, but the import is still required because TypeScript needs the type in scope to check the object literal against the `Database` interface.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/adapters/db/fake.test.ts`
Expected: PASS (all existing tests plus the new ones from Step 1).
Run: `npm run typecheck` — expect this to FAIL at this point, because `src/adapters/db/real.ts` does not yet implement the new `Database` methods (TypeScript will report `createRealDatabase`'s return value as missing `identity.getSeekerProfileById`, `identity.setUserPhone`, and `notifications`). This is expected — proceed to Step 7.

- [ ] **Step 7: Implement in `src/adapters/db/real.ts`**

Add `notifications` (the table) to the schema import list at the top of the file (which currently ends with `adminAuditLog,`):
```ts
  adminAuditLog,
  notifications,
} from "../../../drizzle/schema";
```
Add `NotificationRecord` and `NotificationChannel` to the type import list (which currently ends with `AdminAuditLogRecord,`):
```ts
  AdminAuditLogRecord,
  NotificationRecord,
  NotificationChannel,
} from "./types";
```
(`seekerProfiles` and `SeekerProfileRecord` are already imported in this file — no change needed for those.)

Immediately after the existing `getInsiderProfileById` method in the `identity` block, add:
```ts
      async getSeekerProfileById(seekerProfileId) {
        const [row] = await db.select().from(seekerProfiles).where(eq(seekerProfiles.id, seekerProfileId));
        return (row as SeekerProfileRecord) ?? null;
      },
```
Immediately after the existing `setUserRole` method (the last method in the `identity` block), add:
```ts
      async setUserPhone(userId, phone) {
        const [row] = await db.update(users).set({ phone }).where(eq(users.id, userId)).returning();
        if (!row) throw new Error(`User ${userId} not found`);
      },
```

Immediately after the `requests: { ... }` block's closing `},` (i.e. right before the final `};` and `}` that close the `db` object literal and the function), add:
```ts
    notifications: {
      async create(input) {
        const [row] = await db
          .insert(notifications)
          .values({ userId: input.userId, template: input.template, payload: input.payload })
          .returning();
        return row as NotificationRecord;
      },
      async getById(id) {
        const [row] = await db.select().from(notifications).where(eq(notifications.id, id));
        return (row as NotificationRecord) ?? null;
      },
      async markSent(id, channel, deliveredAt) {
        await db.update(notifications).set({ status: "sent", channel, deliveredAt }).where(eq(notifications.id, id));
      },
      async markFailed(id, error) {
        await db.update(notifications).set({ status: "failed", error }).where(eq(notifications.id, id));
      },
    },
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm run typecheck` — must pass now.
Run: `npx vitest run src/adapters/db/fake.test.ts` — expect PASS.
Run: `npm test` — full suite passes.
Run: `npm run lint` — clean.

- [ ] **Step 9: Generate and inspect the migration**

Run: `npm run db:generate -- --name=notifications_and_phone`
This does not require a live database connection — drizzle-kit diffs `drizzle/schema.ts` against the migration history's stored snapshots. It should produce a new file `drizzle/migrations/0009_notifications_and_phone.sql` (the next number after the existing `0008_admin_audit_log_append_only.sql`) plus updates to `drizzle/migrations/meta/_journal.json` and a new snapshot file under `drizzle/migrations/meta/`.

Open the generated `.sql` file and confirm it contains, at minimum:
- `ALTER TABLE "users" ADD COLUMN "phone" text;` (or equivalent — no `NOT NULL`, no default, since the column is nullable)
- `CREATE TABLE "notifications" (...)` with all 8 columns from Step 3's schema, the two `CHECK` constraints (`status`, `channel`), and a foreign key to `users(id)`
- An index on `notifications.user_id`

If the generated SQL is missing any of these, the `drizzle/schema.ts` edit in Step 3 has a mistake — fix `schema.ts`, delete the incorrectly-generated migration file and its journal/snapshot entries, and re-run `npm run db:generate -- --name=notifications_and_phone`.

Do NOT run `npm run db:migrate` against a live database as part of this task — matching this plan's Global Constraints, that verification is optional and not required to complete this task.

- [ ] **Step 10: Commit**

```bash
git add drizzle/schema.ts drizzle/migrations src/adapters/db/types.ts src/adapters/db/fake.ts src/adapters/db/fake.test.ts src/adapters/db/real.ts
git commit -m "feat(db): add users.phone and a notifications table with fake/real Database methods"
```

---

## Task 4: Template registry

**Files:**
- Create: `src/modules/notifications/templates.ts`
- Create: `src/modules/notifications/templates.test.ts`

**Interfaces:**
- Consumes: `brand` from `../../config/brand` (existing).
- Produces: `TemplateName`, `templateNames`, `TemplateDefinition`, `templates` — consumed by Task 5's `notifications.ts`.

- [ ] **Step 1: Write the failing tests**

Create `src/modules/notifications/templates.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { templates, templateNames } from "./templates";

describe("templates", () => {
  it("has exactly the 5 expected template names", () => {
    expect([...templateNames].sort()).toEqual(
      ["proof.rejected", "proof.verified", "request.accepted", "request.declined", "request.expired"].sort()
    );
  });

  for (const name of templateNames) {
    it(`"${name}" defines all four render functions and a WhatsApp template name`, () => {
      const definition = templates[name];
      expect(typeof definition.renderEmail).toBe("function");
      expect(typeof definition.renderWhatsAppText).toBe("function");
      expect(typeof definition.whatsappTemplateName).toBe("string");
      expect(definition.whatsappTemplateName.length).toBeGreaterThan(0);
      expect(typeof definition.whatsappParams).toBe("function");
    });
  }

  it("request.accepted renders email and WhatsApp text from a valid payload, and rejects an invalid one", () => {
    const definition = templates["request.accepted"];
    const payload = { requestId: "r1", companyName: "Acme" };
    const email = definition.renderEmail(payload);
    expect(email.subject.length).toBeGreaterThan(0);
    expect(email.html).toContain("Acme");
    expect(definition.renderWhatsAppText(payload)).toContain("Acme");
    expect(() => definition.payloadSchema.parse({ requestId: "r1" })).toThrow();
  });

  it("request.declined and request.expired render refundedCredits into both email and WhatsApp text", () => {
    for (const name of ["request.declined", "request.expired"] as const) {
      const definition = templates[name];
      const payload = { requestId: "r1", companyName: "Acme", refundedCredits: 3 };
      const email = definition.renderEmail(payload);
      expect(email.html).toContain("3");
      expect(definition.renderWhatsAppText(payload)).toContain("3");
      expect(() => definition.payloadSchema.parse({ requestId: "r1", companyName: "Acme" })).toThrow();
    }
  });

  it("proof.verified renders different copy for insider vs seeker audience", () => {
    const definition = templates["proof.verified"];
    const insiderPayload = { requestId: "r1", companyName: "Acme", audience: "insider" as const, seekerName: "Priya" };
    const seekerPayload = { requestId: "r1", companyName: "Acme", audience: "seeker" as const };
    const insiderEmail = definition.renderEmail(insiderPayload);
    const seekerEmail = definition.renderEmail(seekerPayload);
    expect(insiderEmail.html).toContain("Priya");
    expect(insiderEmail.subject).not.toBe(seekerEmail.subject);
    expect(() => definition.payloadSchema.parse({ requestId: "r1", companyName: "Acme" })).toThrow();
  });

  it("proof.rejected renders the reason into both email and WhatsApp text, and requires one", () => {
    const definition = templates["proof.rejected"];
    const payload = { requestId: "r1", seekerName: "Priya", reason: "Screenshot was unreadable" };
    expect(definition.renderEmail(payload).html).toContain("Screenshot was unreadable");
    expect(definition.renderWhatsAppText(payload)).toContain("Screenshot was unreadable");
    expect(() => definition.payloadSchema.parse({ requestId: "r1", seekerName: "Priya" })).toThrow();
  });

  it("never hardcodes the brand name — every renderer uses config/brand.ts", () => {
    // A quick structural guard: every email renderer's output must contain the
    // configured brand name for at least one template whose copy names the brand.
    const email = templates["request.accepted"].renderEmail({ requestId: "r1", companyName: "Acme" });
    expect(email.html).toMatch(/GetNudgd/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/notifications/templates.test.ts`
Expected: FAIL — `./templates` doesn't exist yet.

- [ ] **Step 3: Implement `src/modules/notifications/templates.ts`**

```ts
import { z } from "zod";
import { brand } from "../../config/brand";

export const requestAcceptedPayloadSchema = z.object({
  requestId: z.string().min(1),
  companyName: z.string().min(1),
});
export type RequestAcceptedPayload = z.infer<typeof requestAcceptedPayloadSchema>;

export const requestDeclinedPayloadSchema = z.object({
  requestId: z.string().min(1),
  companyName: z.string().min(1),
  refundedCredits: z.number().int().nonnegative(),
});
export type RequestDeclinedPayload = z.infer<typeof requestDeclinedPayloadSchema>;

export const requestExpiredPayloadSchema = requestDeclinedPayloadSchema;
export type RequestExpiredPayload = RequestDeclinedPayload;

export const proofVerifiedPayloadSchema = z.object({
  requestId: z.string().min(1),
  companyName: z.string().min(1),
  audience: z.enum(["insider", "seeker"]),
  seekerName: z.string().min(1).optional(),
});
export type ProofVerifiedPayload = z.infer<typeof proofVerifiedPayloadSchema>;

export const proofRejectedPayloadSchema = z.object({
  requestId: z.string().min(1),
  seekerName: z.string().min(1),
  reason: z.string().min(1),
});
export type ProofRejectedPayload = z.infer<typeof proofRejectedPayloadSchema>;

export interface EmailContent {
  subject: string;
  html: string;
}

export interface TemplateDefinition {
  payloadSchema: z.ZodType;
  renderEmail(payload: unknown): EmailContent;
  renderWhatsAppText(payload: unknown): string;
  whatsappTemplateName: string;
  whatsappParams(payload: unknown): Record<string, string>;
}

export const templateNames = [
  "request.accepted",
  "request.declined",
  "request.expired",
  "proof.verified",
  "proof.rejected",
] as const;
export type TemplateName = (typeof templateNames)[number];

export const templates: Record<TemplateName, TemplateDefinition> = {
  "request.accepted": {
    payloadSchema: requestAcceptedPayloadSchema,
    renderEmail(raw) {
      const payload = requestAcceptedPayloadSchema.parse(raw);
      return {
        subject: "Your Insider Request was accepted",
        html: `<p>Good news — an Insider at ${payload.companyName} accepted your Insider Request on ${brand.name}. They'll submit you internally soon.</p>`,
      };
    },
    renderWhatsAppText(raw) {
      const payload = requestAcceptedPayloadSchema.parse(raw);
      return `Good news! An Insider at ${payload.companyName} accepted your Insider Request on ${brand.name}.`;
    },
    whatsappTemplateName: "request_accepted",
    whatsappParams(raw) {
      const payload = requestAcceptedPayloadSchema.parse(raw);
      return { companyName: payload.companyName };
    },
  },
  "request.declined": {
    payloadSchema: requestDeclinedPayloadSchema,
    renderEmail(raw) {
      const payload = requestDeclinedPayloadSchema.parse(raw);
      return {
        subject: "Your Insider Request was declined",
        html: `<p>An Insider at ${payload.companyName} declined your Insider Request on ${brand.name}. ${payload.refundedCredits} credits have been refunded to your account.</p>`,
      };
    },
    renderWhatsAppText(raw) {
      const payload = requestDeclinedPayloadSchema.parse(raw);
      return `An Insider at ${payload.companyName} declined your Insider Request. ${payload.refundedCredits} credits refunded.`;
    },
    whatsappTemplateName: "request_declined",
    whatsappParams(raw) {
      const payload = requestDeclinedPayloadSchema.parse(raw);
      return { companyName: payload.companyName, refundedCredits: String(payload.refundedCredits) };
    },
  },
  "request.expired": {
    payloadSchema: requestExpiredPayloadSchema,
    renderEmail(raw) {
      const payload = requestExpiredPayloadSchema.parse(raw);
      return {
        subject: "Your Insider Request expired",
        html: `<p>Your Insider Request to ${payload.companyName} on ${brand.name} expired without a response. ${payload.refundedCredits} credits have been refunded to your account.</p>`,
      };
    },
    renderWhatsAppText(raw) {
      const payload = requestExpiredPayloadSchema.parse(raw);
      return `Your Insider Request to ${payload.companyName} expired. ${payload.refundedCredits} credits refunded.`;
    },
    whatsappTemplateName: "request_expired",
    whatsappParams(raw) {
      const payload = requestExpiredPayloadSchema.parse(raw);
      return { companyName: payload.companyName, refundedCredits: String(payload.refundedCredits) };
    },
  },
  "proof.verified": {
    payloadSchema: proofVerifiedPayloadSchema,
    renderEmail(raw) {
      const payload = proofVerifiedPayloadSchema.parse(raw);
      if (payload.audience === "insider") {
        return {
          subject: `You vouched for ${payload.seekerName ?? "a Seeker"} — verified!`,
          html: `<p>Your vouch for ${payload.seekerName ?? "the Seeker"} at ${payload.companyName} has been verified on ${brand.name}. Your Insider Rewards will follow once processed.</p>`,
        };
      }
      return {
        subject: "You were submitted internally!",
        html: `<p>Great news — the Insider at ${payload.companyName} has confirmed you were submitted internally on ${brand.name}.</p>`,
      };
    },
    renderWhatsAppText(raw) {
      const payload = proofVerifiedPayloadSchema.parse(raw);
      if (payload.audience === "insider") {
        return `Your vouch for ${payload.seekerName ?? "the Seeker"} at ${payload.companyName} has been verified. Rewards to follow.`;
      }
      return `Great news — the Insider at ${payload.companyName} confirmed you were submitted internally!`;
    },
    whatsappTemplateName: "proof_verified",
    whatsappParams(raw) {
      const payload = proofVerifiedPayloadSchema.parse(raw);
      return {
        companyName: payload.companyName,
        audience: payload.audience,
        seekerName: payload.seekerName ?? "",
      };
    },
  },
  "proof.rejected": {
    payloadSchema: proofRejectedPayloadSchema,
    renderEmail(raw) {
      const payload = proofRejectedPayloadSchema.parse(raw);
      return {
        subject: `Your proof for ${payload.seekerName} needs another look`,
        html: `<p>Your submitted proof for ${payload.seekerName} on ${brand.name} was not accepted: ${payload.reason}. Please resubmit.</p>`,
      };
    },
    renderWhatsAppText(raw) {
      const payload = proofRejectedPayloadSchema.parse(raw);
      return `Your proof for ${payload.seekerName} wasn't accepted: ${payload.reason}. Please resubmit.`;
    },
    whatsappTemplateName: "proof_rejected",
    whatsappParams(raw) {
      const payload = proofRejectedPayloadSchema.parse(raw);
      return { seekerName: payload.seekerName, reason: payload.reason };
    },
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/modules/notifications/templates.test.ts`
Expected: PASS (all tests, including the per-template-name loop).
Run: `npm run typecheck` and `npm run lint` — both clean.

- [ ] **Step 5: Commit**

```bash
git add src/modules/notifications/templates.ts src/modules/notifications/templates.test.ts
git commit -m "feat(notifications): add the 5-template registry with email and WhatsApp renderers"
```

---

## Task 5: `notify()` and `deliverNotification()`

**Files:**
- Create: `src/modules/notifications/notifications.ts`
- Create: `src/modules/notifications/notifications.test.ts`

**Interfaces:**
- Consumes: `Database`, `NotificationChannel` from `../../adapters/db/types` (Task 3); `QueueClient` from `../../jobs/queue` (existing, extended by Task 1); `EmailSender` from `../../adapters/email/types` (existing); `WhatsAppGateway` from `../../adapters/whatsapp/types` (Task 2); `templates`, `TemplateName` from `./templates` (Task 4).
- Produces: `NotifyDeps`, `DeliveryDeps`, `notify()`, `deliverNotification()`, `NotificationNotFoundError` — consumed by Task 6's `requests.ts`/`admin.ts` and Task 7's `worker.ts`.

- [ ] **Step 1: Write the failing tests**

Create `src/modules/notifications/notifications.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { createFakeDatabase } from "../../adapters/db/fake";
import { createFakeQueueClient } from "../../jobs/queue.fake";
import { createFakeEmailSender } from "../../adapters/email/fake";
import { createFakeWhatsAppGateway } from "../../adapters/whatsapp/fake";
import type { QueueClient } from "../../jobs/queue";
import { notify, deliverNotification, NotificationNotFoundError } from "./notifications";

describe("notify", () => {
  it("creates a pending notification row and enqueues notify.send with a singleton key and retry options", async () => {
    const { db } = createFakeDatabase();
    const user = await db.identity.findOrCreateUser("fb-n1", "n1@x.com", "seeker");
    const sentJobs: Array<{
      queueName: string;
      payload: { notificationId: string };
      options?: { singletonKey?: string; retryLimit?: number; retryBackoff?: boolean };
    }> = [];
    const spyQueue: QueueClient = {
      async start() {},
      async stop() {},
      async send(queueName, payload, options) {
        sentJobs.push({ queueName, payload: payload as { notificationId: string }, options });
        return "job-1";
      },
      async work() {},
      async schedule() {},
    };

    await notify({ db, queue: spyQueue }, user.id, "request.accepted", { requestId: "r1", companyName: "Acme" });

    expect(sentJobs).toHaveLength(1);
    expect(sentJobs[0].queueName).toBe("notify.send");
    const notificationId = sentJobs[0].payload.notificationId;
    expect(sentJobs[0].options?.singletonKey).toBe(`notify:${notificationId}`);
    expect(sentJobs[0].options?.retryLimit).toBe(3);
    expect(sentJobs[0].options?.retryBackoff).toBe(true);

    const record = await db.notifications.getById(notificationId);
    expect(record?.status).toBe("pending");
    expect(record?.userId).toBe(user.id);
    expect(record?.template).toBe("request.accepted");
    expect(record?.payload).toEqual({ requestId: "r1", companyName: "Acme" });
  });

  it("throws synchronously on a payload that fails the template's schema, without creating a row or enqueueing", async () => {
    const { db } = createFakeDatabase();
    const user = await db.identity.findOrCreateUser("fb-n2", "n2@x.com", "seeker");
    const queue = createFakeQueueClient();
    await queue.start();
    const sendSpy = vi.spyOn(queue, "send");

    await expect(
      notify({ db, queue }, user.id, "request.accepted", { requestId: "r1" }) // missing companyName
    ).rejects.toThrow();
    expect(sendSpy).not.toHaveBeenCalled();
  });
});

describe("deliverNotification", () => {
  async function seedPendingNotification(overrides?: { phone?: string }) {
    const { db } = createFakeDatabase();
    const user = await db.identity.findOrCreateUser(`fb-dn-${Math.random()}`, `dn${Math.random()}@x.com`, "seeker");
    if (overrides?.phone) await db.identity.setUserPhone(user.id, overrides.phone);
    const record = await db.notifications.create({
      userId: user.id,
      template: "request.accepted",
      payload: { requestId: "r1", companyName: "Acme" },
    });
    return { db, user, record };
  }

  it("delivers via a WhatsApp session message when an active session exists", async () => {
    const { db, user, record } = await seedPendingNotification({ phone: "+911111111111" });
    const { sender: email } = createFakeEmailSender();
    const { gateway: whatsapp, setActiveSession, sentSessionMessages } = createFakeWhatsAppGateway();
    setActiveSession(user.id, true);

    await deliverNotification({ db, email, whatsapp }, record.id);

    expect(sentSessionMessages).toHaveLength(1);
    const updated = await db.notifications.getById(record.id);
    expect(updated?.status).toBe("sent");
    expect(updated?.channel).toBe("whatsapp_session");
  });

  it("falls back to a WhatsApp template message when there is no active session", async () => {
    const { db, record } = await seedPendingNotification({ phone: "+911111111111" });
    const { sender: email } = createFakeEmailSender();
    const { gateway: whatsapp, sentTemplateMessages } = createFakeWhatsAppGateway();

    await deliverNotification({ db, email, whatsapp }, record.id);

    expect(sentTemplateMessages).toHaveLength(1);
    const updated = await db.notifications.getById(record.id);
    expect(updated?.status).toBe("sent");
    expect(updated?.channel).toBe("whatsapp_template");
  });

  it("skips WhatsApp entirely and goes straight to email when the user has no phone on file", async () => {
    const { db, record } = await seedPendingNotification();
    const { sender: email, sent } = createFakeEmailSender();
    const { gateway: whatsapp, sentSessionMessages, sentTemplateMessages } = createFakeWhatsAppGateway();

    await deliverNotification({ db, email, whatsapp }, record.id);

    expect(sentSessionMessages).toHaveLength(0);
    expect(sentTemplateMessages).toHaveLength(0);
    expect(sent).toHaveLength(1);
    const updated = await db.notifications.getById(record.id);
    expect(updated?.status).toBe("sent");
    expect(updated?.channel).toBe("email");
  });

  it("falls back to email immediately when every WhatsApp attempt fails", async () => {
    const { db, record } = await seedPendingNotification({ phone: "+911111111111" });
    const { sender: email, sent } = createFakeEmailSender();
    const { gateway: whatsapp, setTemplateSendFailure } = createFakeWhatsAppGateway();
    setTemplateSendFailure("+911111111111", true);

    await deliverNotification({ db, email, whatsapp }, record.id);

    expect(sent).toHaveLength(1);
    const updated = await db.notifications.getById(record.id);
    expect(updated?.status).toBe("sent");
    expect(updated?.channel).toBe("email");
  });

  it("marks the notification failed and rethrows when every channel fails", async () => {
    const { db, record } = await seedPendingNotification({ phone: "+911111111111" });
    const failingEmail = {
      async send(): Promise<{ id: string }> {
        throw new Error("Brevo is down");
      },
    };
    const { gateway: whatsapp, setTemplateSendFailure } = createFakeWhatsAppGateway();
    setTemplateSendFailure("+911111111111", true);

    await expect(deliverNotification({ db, email: failingEmail, whatsapp }, record.id)).rejects.toThrow();

    const updated = await db.notifications.getById(record.id);
    expect(updated?.status).toBe("failed");
    expect(updated?.error).toContain("Brevo is down");
  });

  it("throws NotificationNotFoundError for an unknown notification id", async () => {
    const { db } = createFakeDatabase();
    const { sender: email } = createFakeEmailSender();
    const { gateway: whatsapp } = createFakeWhatsAppGateway();
    await expect(deliverNotification({ db, email, whatsapp }, "nope")).rejects.toThrow(NotificationNotFoundError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/notifications/notifications.test.ts`
Expected: FAIL — `./notifications` doesn't exist yet.

- [ ] **Step 3: Implement `src/modules/notifications/notifications.ts`**

```ts
import type { Database, NotificationChannel } from "../../adapters/db/types";
import type { QueueClient } from "../../jobs/queue";
import type { EmailSender } from "../../adapters/email/types";
import type { WhatsAppGateway } from "../../adapters/whatsapp/types";
import { templates, type TemplateName } from "./templates";

export interface NotifyDeps {
  db: Database;
  queue: QueueClient;
}

export async function notify(
  deps: NotifyDeps,
  userId: string,
  template: TemplateName,
  payload: unknown
): Promise<void> {
  const definition = templates[template];
  const parsedPayload = definition.payloadSchema.parse(payload);
  const record = await deps.db.notifications.create({ userId, template, payload: parsedPayload });
  await deps.queue.send(
    "notify.send",
    { notificationId: record.id },
    { singletonKey: `notify:${record.id}`, retryLimit: 3, retryBackoff: true }
  );
}

export interface DeliveryDeps {
  db: Database;
  email: EmailSender;
  whatsapp: WhatsAppGateway;
}

export class NotificationNotFoundError extends Error {
  constructor(notificationId: string) {
    super(`Notification ${notificationId} not found`);
    this.name = "NotificationNotFoundError";
  }
}

export async function deliverNotification(deps: DeliveryDeps, notificationId: string): Promise<void> {
  const record = await deps.db.notifications.getById(notificationId);
  if (!record) throw new NotificationNotFoundError(notificationId);

  const user = await deps.db.identity.getUserById(record.userId);
  if (!user) throw new Error(`User ${record.userId} not found for notification ${notificationId}`);

  const definition = templates[record.template as TemplateName];
  const payload = definition.payloadSchema.parse(record.payload);

  let channel: NotificationChannel | null = null;

  if (user.phone) {
    try {
      const hasSession = await deps.whatsapp.hasActiveSession(record.userId);
      if (hasSession) {
        await deps.whatsapp.sendSessionMessage(user.phone, definition.renderWhatsAppText(payload));
        channel = "whatsapp_session";
      }
    } catch {
      // Fall through to the template-message attempt below.
    }

    if (!channel) {
      try {
        await deps.whatsapp.sendTemplateMessage(
          user.phone,
          definition.whatsappTemplateName,
          definition.whatsappParams(payload)
        );
        channel = "whatsapp_template";
      } catch {
        // Fall through to the email fallback below.
      }
    }
  }

  if (!channel) {
    try {
      const rendered = definition.renderEmail(payload);
      await deps.email.send({ to: user.email, subject: rendered.subject, html: rendered.html });
      channel = "email";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await deps.db.notifications.markFailed(notificationId, message);
      throw new Error(`Failed to deliver notification ${notificationId} on any channel: ${message}`);
    }
  }

  await deps.db.notifications.markSent(notificationId, channel, new Date());
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/modules/notifications/notifications.test.ts`
Expected: PASS (all tests).
Run: `npm test` — full suite passes.
Run: `npm run typecheck` and `npm run lint` — both clean.

- [ ] **Step 5: Commit**

```bash
git add src/modules/notifications/notifications.ts src/modules/notifications/notifications.test.ts
git commit -m "feat(notifications): add notify() enqueue phase and deliverNotification() channel-selection delivery phase"
```

---

## Task 6: Wire `notify()` into the 5 request-outcome call sites

**Files:**
- Modify: `src/modules/requests/requests.ts`
- Modify: `src/modules/requests/requests.test.ts`
- Modify: `src/modules/admin/admin.ts`
- Modify: `src/modules/admin/admin.test.ts`

**Interfaces:**
- Consumes: `notify`, `type NotifyDeps` from `../notifications/notifications` (Task 5).
- Produces: `AdminDeps` gains a required `queue: QueueClient` field (mirroring `RequestsDeps`, which already has it) — no new exports beyond that; `RequestsDeps`'s shape is unchanged (it already has `{ db, queue }`, which structurally satisfies `NotifyDeps`).

**Cross-file note (mirrors the exact class of issue the Phase 1 Timers plan hit for `RequestsDeps`):** `AdminDeps` becoming required-`queue` breaks typecheck for every existing `{ db }`-only construction of it. Confirmed by reading the live files: `admin.test.ts`'s `listPendingProofs({ db })` call (the second test in its `describe("listPendingProofs", ...)` block) is the one bare site — `makeProofPendingRequest`'s own `const deps = { db, queue: createFakeQueueClient() };` already includes `queue` and needs no change. Fix the one bare site in this task, not a later one.

- [ ] **Step 1: Read the current `RequestsDeps`, `accept`, `decline`, `expire`**

`src/modules/requests/requests.ts` currently starts:
```ts
import type { Database, InsiderRequestRecord, PostLedgerEntryInput } from "../../adapters/db/types";
import { RequestStateConflictError } from "../../adapters/db/types";
import { getRulesWithVersion } from "../config/config";
import { UnknownCompanyTierError } from "../insiders/insiders";
import { escrowFor, platformAccount } from "../ledger/ledger";
import type { QueueClient } from "../../jobs/queue";
import { nextState, type RequestState } from "./state";

export interface RequestsDeps {
  db: Database;
  queue: QueueClient;
}
```
and `accept`, `decline`, `expire` currently read exactly:
```ts
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
  const { rules } = await getRulesWithVersion(deps, record.rulesVersion);
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
  const { rules } = await getRulesWithVersion(deps, record.rulesVersion);
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

- [ ] **Step 2: Write the failing tests**

Add this import to `src/modules/requests/requests.test.ts` (its current imports end with the `sendRequest, accept, ...` line from `./requests`):
```ts
import { notify } from "../notifications/notifications";
```
(This import is only needed so the test file's own spy-based tests below can reference `db.notifications` types indirectly through `notify`'s usage patterns — actually, the tests below call `accept`/`decline`/`expire` directly, not `notify`, so this import is NOT needed. Do not add it.)

Add these three tests to the existing `describe("accept", ...)`, `describe("decline", ...)`, and `describe("expire", ...)` blocks respectively (each as a new `it(...)` inside its existing block, using the same inline-seeding style as the existing "enqueues a request.expire job..." test in the `describe("sendRequest", ...)` block — do not reuse `makeVerifiedInsiderAndFundedSeeker`, since these need a spy queue, and reproduce the exact current content of each `describe` block before pasting to confirm placement):

In `describe("accept", ...)`:
```ts
  it("notifies the seeker via notify() when a request is accepted", async () => {
    const sentJobs: Array<{ queueName: string; payload: { notificationId: string } }> = [];
    const spyQueue: QueueClient = {
      async start() {},
      async stop() {},
      async send(queueName, payload) {
        sentJobs.push({ queueName, payload: payload as { notificationId: string } });
        return "job-1";
      },
      async work() {},
      async schedule() {},
    };
    const { db, seedConfig, seedCompany } = createFakeDatabase();
    seedConfig({ key: "rules", version: 1, placeholder: true, value: RULES_VALUE });
    const company = seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const seekerUser = await db.identity.findOrCreateUser("fb-acc-n1", "accn1@x.com", "seeker");
    const seekerProfile = await db.identity.createSeekerProfile(seekerUser.id, "Accept Notify Seeker");
    await db.ledger.postTxn({
      idempotencyKey: "grant:accn1",
      eventType: "credits.grant",
      entries: [
        { ownerType: "platform", ownerId: "platform", currency: "credits", amount: -5 },
        { ownerType: "seeker", ownerId: seekerProfile.id, currency: "credits", amount: 5 },
      ],
    });
    const insiderUser = await db.identity.findOrCreateUser("fb-acc-n2", "accn2@acme.com", "seeker");
    const insiderProfile = await db.identity.findOrCreateInsiderProfile(insiderUser.id, company.id, "accn2@acme.com");
    await db.identity.markInsiderVerified(insiderProfile.id, new Date());
    const deps = { db, queue: spyQueue };
    const request = await sendRequest(deps, {
      idempotencyKey: "accn1",
      seekerProfileId: seekerProfile.id,
      insiderProfileId: insiderProfile.id,
    });
    sentJobs.length = 0; // discard sendRequest's own request.expire enqueue

    await accept(deps, request.id);

    const notifyJob = sentJobs.find((j) => j.queueName === "notify.send");
    expect(notifyJob).toBeDefined();
    const record = await db.notifications.getById(notifyJob!.payload.notificationId);
    expect(record?.template).toBe("request.accepted");
    expect(record?.userId).toBe(seekerUser.id);
    expect(record?.payload).toEqual({ requestId: request.id, companyName: "Acme" });
  });
```

In `describe("decline", ...)`:
```ts
  it("notifies the seeker via notify() when a request is declined, including the refunded amount", async () => {
    const sentJobs: Array<{ queueName: string; payload: { notificationId: string } }> = [];
    const spyQueue: QueueClient = {
      async start() {},
      async stop() {},
      async send(queueName, payload) {
        sentJobs.push({ queueName, payload: payload as { notificationId: string } });
        return "job-1";
      },
      async work() {},
      async schedule() {},
    };
    const { db, seedConfig, seedCompany } = createFakeDatabase();
    seedConfig({ key: "rules", version: 1, placeholder: true, value: RULES_VALUE });
    const company = seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const seekerUser = await db.identity.findOrCreateUser("fb-dec-n1", "decn1@x.com", "seeker");
    const seekerProfile = await db.identity.createSeekerProfile(seekerUser.id, "Decline Notify Seeker");
    await db.ledger.postTxn({
      idempotencyKey: "grant:decn1",
      eventType: "credits.grant",
      entries: [
        { ownerType: "platform", ownerId: "platform", currency: "credits", amount: -5 },
        { ownerType: "seeker", ownerId: seekerProfile.id, currency: "credits", amount: 5 },
      ],
    });
    const insiderUser = await db.identity.findOrCreateUser("fb-dec-n2", "decn2@acme.com", "seeker");
    const insiderProfile = await db.identity.findOrCreateInsiderProfile(insiderUser.id, company.id, "decn2@acme.com");
    await db.identity.markInsiderVerified(insiderProfile.id, new Date());
    const deps = { db, queue: spyQueue };
    const request = await sendRequest(deps, {
      idempotencyKey: "decn1",
      seekerProfileId: seekerProfile.id,
      insiderProfileId: insiderProfile.id,
    });
    sentJobs.length = 0;

    await decline(deps, request.id);

    const notifyJob = sentJobs.find((j) => j.queueName === "notify.send");
    expect(notifyJob).toBeDefined();
    const record = await db.notifications.getById(notifyJob!.payload.notificationId);
    expect(record?.template).toBe("request.declined");
    expect(record?.userId).toBe(seekerUser.id);
    expect(record?.payload).toEqual({ requestId: request.id, companyName: "Acme", refundedCredits: 3 });
  });
```

In `describe("expire", ...)`:
```ts
  it("notifies the seeker via notify() when a request expires, including the refunded amount", async () => {
    const sentJobs: Array<{ queueName: string; payload: { notificationId: string } }> = [];
    const spyQueue: QueueClient = {
      async start() {},
      async stop() {},
      async send(queueName, payload) {
        sentJobs.push({ queueName, payload: payload as { notificationId: string } });
        return "job-1";
      },
      async work() {},
      async schedule() {},
    };
    const { db, seedConfig, seedCompany } = createFakeDatabase();
    seedConfig({ key: "rules", version: 1, placeholder: true, value: RULES_VALUE });
    const company = seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const seekerUser = await db.identity.findOrCreateUser("fb-exp-n1", "expn1@x.com", "seeker");
    const seekerProfile = await db.identity.createSeekerProfile(seekerUser.id, "Expire Notify Seeker");
    await db.ledger.postTxn({
      idempotencyKey: "grant:expn1",
      eventType: "credits.grant",
      entries: [
        { ownerType: "platform", ownerId: "platform", currency: "credits", amount: -5 },
        { ownerType: "seeker", ownerId: seekerProfile.id, currency: "credits", amount: 5 },
      ],
    });
    const insiderUser = await db.identity.findOrCreateUser("fb-exp-n2", "expn2@acme.com", "seeker");
    const insiderProfile = await db.identity.findOrCreateInsiderProfile(insiderUser.id, company.id, "expn2@acme.com");
    await db.identity.markInsiderVerified(insiderProfile.id, new Date());
    const deps = { db, queue: spyQueue };
    const request = await sendRequest(deps, {
      idempotencyKey: "expn1",
      seekerProfileId: seekerProfile.id,
      insiderProfileId: insiderProfile.id,
    });
    sentJobs.length = 0;

    await expire(deps, request.id);

    const notifyJob = sentJobs.find((j) => j.queueName === "notify.send");
    expect(notifyJob).toBeDefined();
    const record = await db.notifications.getById(notifyJob!.payload.notificationId);
    expect(record?.template).toBe("request.expired");
    expect(record?.userId).toBe(seekerUser.id);
    expect(record?.payload).toEqual({ requestId: request.id, companyName: "Acme", refundedCredits: 2 });
  });

  it("does not send a duplicate notification when expire() hits its RequestStateConflictError fallback path", async () => {
    const sentJobs: Array<{ queueName: string }> = [];
    const spyQueue: QueueClient = {
      async start() {},
      async stop() {},
      async send(queueName) {
        sentJobs.push({ queueName });
        return "job-1";
      },
      async work() {},
      async schedule() {},
    };
    const { db, seedConfig, seedCompany } = createFakeDatabase();
    seedConfig({ key: "rules", version: 1, placeholder: true, value: RULES_VALUE });
    const company = seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const seekerUser = await db.identity.findOrCreateUser("fb-exp-n3", "expn3@x.com", "seeker");
    const seekerProfile = await db.identity.createSeekerProfile(seekerUser.id, "Expire Conflict Seeker");
    await db.ledger.postTxn({
      idempotencyKey: "grant:expn3",
      eventType: "credits.grant",
      entries: [
        { ownerType: "platform", ownerId: "platform", currency: "credits", amount: -5 },
        { ownerType: "seeker", ownerId: seekerProfile.id, currency: "credits", amount: 5 },
      ],
    });
    const insiderUser = await db.identity.findOrCreateUser("fb-exp-n4", "expn4@acme.com", "seeker");
    const insiderProfile = await db.identity.findOrCreateInsiderProfile(insiderUser.id, company.id, "expn4@acme.com");
    await db.identity.markInsiderVerified(insiderProfile.id, new Date());
    const deps = { db, queue: spyQueue };
    const request = await sendRequest(deps, {
      idempotencyKey: "expn3",
      seekerProfileId: seekerProfile.id,
      insiderProfileId: insiderProfile.id,
    });
    await accept(deps, request.id); // moves the request to ACCEPTED, so a later expire() call is a no-op fallback
    sentJobs.length = 0;

    const result = await expire(deps, request.id);

    expect(result.state).toBe("ACCEPTED");
    expect(sentJobs.some((j) => j.queueName === "notify.send")).toBe(false);
  });
```

Add `import type { QueueClient } from "../../jobs/queue";` to `requests.test.ts` if it is not already imported (it already is, per Task 2 of the Phase 1 Timers plan — confirm before adding a duplicate import).

In `src/modules/admin/admin.test.ts`, change the one bare `listPendingProofs({ db })` call in the `describe("listPendingProofs", ...)` block from:
```ts
  it("returns an empty list when nothing is pending", async () => {
    const { db } = createFakeDatabase();
    expect(await listPendingProofs({ db })).toEqual([]);
  });
```
to:
```ts
  it("returns an empty list when nothing is pending", async () => {
    const { db } = createFakeDatabase();
    expect(await listPendingProofs({ db, queue: createFakeQueueClient() })).toEqual([]);
  });
```

Add two tests to the existing `describe("reviewProof", ...)` block in `admin.test.ts`:
```ts
  it("notifies the insider and the seeker on verify", async () => {
    const { deps, requestId } = await makeProofPendingRequest();
    const notifySpy = vi.spyOn(deps.queue, "send");

    await reviewProof(deps, { idempotencyKey: "notifrev1", adminUserId: "admin-1", requestId, decision: "verify" });

    const notifyCalls = notifySpy.mock.calls.filter(([queueName]) => queueName === "notify.send");
    expect(notifyCalls).toHaveLength(2);
  });

  it("notifies only the insider on reject", async () => {
    const { deps, requestId } = await makeProofPendingRequest();
    const notifySpy = vi.spyOn(deps.queue, "send");

    await reviewProof(deps, {
      idempotencyKey: "notifrev2",
      adminUserId: "admin-1",
      requestId,
      decision: "reject",
      reason: "Screenshot was unreadable",
    });

    const notifyCalls = notifySpy.mock.calls.filter(([queueName]) => queueName === "notify.send");
    expect(notifyCalls).toHaveLength(1);
  });
```
(`vi` is already imported in this codebase's other test files via `import { describe, it, expect, vi } from "vitest";` — check `admin.test.ts`'s current import line, which currently reads `import { describe, it, expect } from "vitest";`, and add `vi` to it.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/modules/requests/requests.test.ts src/modules/admin/admin.test.ts`
Expected: FAIL — `accept`/`decline`/`expire` don't call `notify()` yet, `AdminDeps` doesn't have `queue` yet, so `reviewProof`'s test setup and the bare `listPendingProofs({ db })` fix won't even typecheck.

- [ ] **Step 4: Implement in `src/modules/requests/requests.ts`**

Add an import for `notify` (add this line to the existing import block, after the `QueueClient` import):
```ts
import { notify } from "../notifications/notifications";
```

Replace `accept`'s body with:
```ts
export async function accept(deps: RequestsDeps, requestId: string): Promise<InsiderRequestRecord> {
  const record = await deps.db.requests.getById(requestId);
  if (!record) throw new Error(`Insider request ${requestId} not found`);
  const toState = nextState(record.state as RequestState, "accept");

  const updated = await deps.db.requests.applyTransition({
    idempotencyKey: `request:${requestId}:accept`,
    requestId,
    event: "accept",
    fromState: record.state,
    toState,
    ledgerEntries: [],
    ledgerEventType: "request.accept",
  });

  try {
    const seekerProfile = await deps.db.identity.getSeekerProfileById(record.seekerProfileId);
    const insiderSummary = await deps.db.insiders.getInsiderById(record.insiderProfileId);
    if (seekerProfile && insiderSummary) {
      await notify(deps, seekerProfile.userId, "request.accepted", {
        requestId,
        companyName: insiderSummary.companyName,
      });
    }
  } catch (err) {
    console.error(`[requests] failed to notify on accept for request ${requestId}`, err);
  }

  return updated;
}
```

Replace `decline`'s body with:
```ts
export async function decline(deps: RequestsDeps, requestId: string): Promise<InsiderRequestRecord> {
  const record = await deps.db.requests.getById(requestId);
  if (!record) throw new Error(`Insider request ${requestId} not found`);
  const toState = nextState(record.state as RequestState, "decline");
  const { rules } = await getRulesWithVersion(deps, record.rulesVersion);
  const entries = refundEntries(requestId, record.seekerProfileId, record.creditCost, rules.refundPercentOnDecline);

  const updated = await deps.db.requests.applyTransition({
    idempotencyKey: `request:${requestId}:decline`,
    requestId,
    event: "decline",
    fromState: record.state,
    toState,
    ledgerEntries: entries,
    ledgerEventType: "request.decline",
  });

  try {
    const seekerProfile = await deps.db.identity.getSeekerProfileById(record.seekerProfileId);
    const insiderSummary = await deps.db.insiders.getInsiderById(record.insiderProfileId);
    if (seekerProfile && insiderSummary) {
      const refundedCredits = Math.round((record.creditCost * rules.refundPercentOnDecline) / 100);
      await notify(deps, seekerProfile.userId, "request.declined", {
        requestId,
        companyName: insiderSummary.companyName,
        refundedCredits,
      });
    }
  } catch (err) {
    console.error(`[requests] failed to notify on decline for request ${requestId}`, err);
  }

  return updated;
}
```

Replace `expire`'s body with:
```ts
export async function expire(deps: RequestsDeps, requestId: string): Promise<InsiderRequestRecord> {
  const record = await deps.db.requests.getById(requestId);
  if (!record) throw new Error(`Insider request ${requestId} not found`);
  if (record.state !== "SENT") return record;

  const toState = nextState(record.state as RequestState, "expire");
  const { rules } = await getRulesWithVersion(deps, record.rulesVersion);
  const entries = refundEntries(requestId, record.seekerProfileId, record.creditCost, rules.refundPercentOnExpiry);

  let updated: InsiderRequestRecord;
  try {
    updated = await deps.db.requests.applyTransition({
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

  try {
    const seekerProfile = await deps.db.identity.getSeekerProfileById(record.seekerProfileId);
    const insiderSummary = await deps.db.insiders.getInsiderById(record.insiderProfileId);
    if (seekerProfile && insiderSummary) {
      const refundedCredits = Math.round((record.creditCost * rules.refundPercentOnExpiry) / 100);
      await notify(deps, seekerProfile.userId, "request.expired", {
        requestId,
        companyName: insiderSummary.companyName,
        refundedCredits,
      });
    }
  } catch (err) {
    console.error(`[requests] failed to notify on expire for request ${requestId}`, err);
  }

  return updated;
}
```
(Note the restructure: the `RequestStateConflictError` catch block now returns early from inside its own `try`/`catch`, before the new notify-on-success block, so the fallback path — where a concurrent caller already expired the request — never sends a duplicate notification. This is the exact behavior Review Focus item 5 requires.)

- [ ] **Step 5: Implement in `src/modules/admin/admin.ts`**

Current file:
```ts
import type { Database, InsiderRequestRecord, VerificationProofRecord } from "../../adapters/db/types";
import { nextState, type RequestState } from "../requests/state";

export interface AdminDeps {
  db: Database;
}
```
Replace with:
```ts
import type { Database, InsiderRequestRecord, VerificationProofRecord } from "../../adapters/db/types";
import type { QueueClient } from "../../jobs/queue";
import { nextState, type RequestState } from "../requests/state";
import { notify } from "../notifications/notifications";

export interface AdminDeps {
  db: Database;
  queue: QueueClient;
}
```

Replace `reviewProof`'s body (currently ending with `return deps.db.requests.applyTransition({ ... });`) with:
```ts
export async function reviewProof(deps: AdminDeps, input: ReviewProofInput): Promise<InsiderRequestRecord> {
  if (input.decision === "reject" && !input.reason) {
    throw new MissingRejectionReasonError();
  }

  const record = await deps.db.requests.getById(input.requestId);
  if (!record) throw new Error(`Insider request ${input.requestId} not found`);

  const event = input.decision === "verify" ? "verify" : "reject";
  const toState = nextState(record.state as RequestState, event);

  const updated = await deps.db.requests.applyTransition({
    idempotencyKey: `review:${input.requestId}:${input.idempotencyKey}`,
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

  try {
    const insiderProfile = await deps.db.identity.getInsiderProfileById(record.insiderProfileId);
    const insiderSummary = await deps.db.insiders.getInsiderById(record.insiderProfileId);
    const seekerProfile = await deps.db.identity.getSeekerProfileById(record.seekerProfileId);

    if (input.decision === "verify") {
      if (insiderProfile && insiderSummary && seekerProfile) {
        await notify(deps, insiderProfile.userId, "proof.verified", {
          requestId: input.requestId,
          companyName: insiderSummary.companyName,
          audience: "insider",
          seekerName: seekerProfile.fullName,
        });
        await notify(deps, seekerProfile.userId, "proof.verified", {
          requestId: input.requestId,
          companyName: insiderSummary.companyName,
          audience: "seeker",
        });
      }
    } else if (insiderProfile && seekerProfile) {
      await notify(deps, insiderProfile.userId, "proof.rejected", {
        requestId: input.requestId,
        seekerName: seekerProfile.fullName,
        reason: input.reason ?? "",
      });
    }
  } catch (err) {
    console.error(`[admin] failed to notify on reviewProof(${input.decision}) for request ${input.requestId}`, err);
  }

  return updated;
}
```
(`input.reason ?? ""` is safe here, not a silent-data-loss risk: the guard clause at the top of the function already threw `MissingRejectionReasonError` if `input.decision === "reject" && !input.reason`, so by the time this `else if` branch runs, `input.reason` is guaranteed truthy at runtime — the `?? ""` only exists to satisfy TypeScript's `string | undefined` type without a non-null assertion, matching this codebase's existing avoidance of `!` assertions.)

Leave `listPendingProofs` unchanged — it doesn't call `notify()`, and `AdminDeps` gaining `queue` doesn't require any change to its own body, only to its callers (fixed in Step 2 above for the one bare `{ db }` test site).

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/modules/requests/requests.test.ts src/modules/admin/admin.test.ts`
Expected: PASS. `requests.test.ts` gains 4 new tests (1 each in `accept`/`decline`/`expire`'s describe blocks, plus the conflict-fallback test in `expire`'s block); `admin.test.ts` gains 2 new tests in `reviewProof`'s describe block, and its one bare `{ db }` site now typechecks.
Run: `npm test` — full suite passes.
Run: `npm run typecheck` and `npm run lint` — both clean.

- [ ] **Step 7: Commit**

```bash
git add src/modules/requests/requests.ts src/modules/requests/requests.test.ts src/modules/admin/admin.ts src/modules/admin/admin.test.ts
git commit -m "feat(requests,admin): notify on accept/decline/expire/proof-verify/proof-reject"
```

---

## Task 7: Wire `notify.send` into the worker, extend the adapter factory

**Files:**
- Modify: `src/jobs/worker.ts`
- Modify: `src/jobs/worker.test.ts`
- Modify: `src/jobs/run-worker.ts`
- Modify: `src/lib/adapters.impl.ts`

**Interfaces:**
- Consumes: `deliverNotification`, `type DeliveryDeps` from `../modules/notifications/notifications` (Task 5); `WhatsAppGateway`, `createFakeWhatsAppGateway` from `../adapters/whatsapp/*` (Task 2).
- Produces: `WorkerDeps` gains `email: EmailSender` and `whatsapp: WhatsAppGateway`; `Adapters` (in `adapters.impl.ts`) gains `whatsapp: WhatsAppGateway`.

- [ ] **Step 1: Read the current `worker.ts`, `worker.test.ts`, `run-worker.ts`, `adapters.impl.ts`**

`src/jobs/worker.ts` currently reads exactly:
```ts
import { z } from "zod";
import type { Database } from "../adapters/db/types";
import type { QueueClient } from "./queue";
import { expire, sweepExpiredSent, type RequestsDeps } from "../modules/requests/requests";

export interface WorkerDeps {
  db: Database;
  queue: QueueClient;
}

const requestExpirePayloadSchema = z.object({ requestId: z.string().min(1) });

export async function startWorker(deps: WorkerDeps): Promise<void> {
  const requestsDeps: RequestsDeps = { db: deps.db, queue: deps.queue };

  // Against the real pg-boss client, work()/schedule() call boss.createQueue()
  // internally, which requires the database connection to already be open —
  // only true after start(). start() must run before any work()/schedule()
  // registration below (see the contract note on QueueClient.start()).
  await deps.queue.start();

  await deps.queue.work("request.expire", async (payload) => {
    const { requestId } = requestExpirePayloadSchema.parse(payload);
    await expire(requestsDeps, requestId);
  });

  await deps.queue.work("requests.sweep", async () => {
    await sweepExpiredSent(requestsDeps, new Date());
  });
  await deps.queue.schedule("requests.sweep", "0 * * * *", {});

  console.log("[worker] started with request.expire and requests.sweep handlers registered");
}
```

`src/jobs/run-worker.ts` currently reads exactly:
```ts
import { getEnv } from "../config/env";
import { getAdapters } from "../lib/adapters.impl";
import { startWorker } from "./worker";

// Fail fast rather than silently expiring nothing: if this is a production
// deploy and ADAPTERS isn't "real" (e.g. missing from the deployed .env), the
// worker would otherwise boot cleanly on in-memory fake adapters and never
// touch the real database or queue.
const env = getEnv();
if (process.env.NODE_ENV === "production" && env.ADAPTERS !== "real") {
  console.error(
    `[worker] refusing to start: NODE_ENV=production but ADAPTERS=${env.ADAPTERS} (expected "real")`
  );
  process.exit(1);
}

const { db, queue } = getAdapters();

startWorker({ db, queue }).catch((err) => {
  console.error("[worker] failed to start", err);
  process.exit(1);
});
```

`src/lib/adapters.impl.ts` currently reads exactly:
```ts
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { getEnv } from "../config/env";
import type { Database } from "../adapters/db/types";
import { createFakeDatabase } from "../adapters/db/fake";
import { createRealDatabase } from "../adapters/db/real";
import type { QueueClient } from "../jobs/queue";
import { createFakeQueueClient } from "../jobs/queue.fake";
import { createRealQueueClient } from "../jobs/queue.real";
import type { AuthAdapter } from "../adapters/auth/types";
import { createFakeAuthAdapter } from "../adapters/auth/fake";
import type { StorageAdapter } from "../adapters/storage/types";
import { createFakeStorageAdapter } from "../adapters/storage/fake";
import type { EmailSender } from "../adapters/email/types";
import { createFakeEmailSender } from "../adapters/email/fake";

export interface Adapters {
  db: Database;
  queue: QueueClient;
  auth: AuthAdapter;
  storage: StorageAdapter;
  email: EmailSender;
}

let cached: Adapters | undefined;

/**
 * The single place the app picks fake vs. real adapters, based on env.ADAPTERS.
 * auth/storage/email have no real.ts implementation yet (Firebase, Cloud Storage,
 * and Brevo are deferred) — they always use fakes until those land, regardless
 * of ADAPTERS. Memoized: the underlying Pool/QueueClient are constructed once
 * and reused across calls within this process.
 *
 * This file intentionally does NOT import "server-only": it is imported directly
 * by the pg-boss worker process (src/jobs/run-worker.ts), which runs under plain
 * Node/tsx, not inside Next's react-server build condition. The "server-only"
 * package's export map only resolves to a no-op under that condition; under
 * plain Node it resolves to a module that throws at import time. App/Next.js
 * code should import the adapters via ../lib/adapters (the thin re-export that
 * does carry the "server-only" guard), not this file directly.
 */
export function getAdapters(): Adapters {
  if (cached) return cached;
  const env = getEnv();

  const db: Database =
    env.ADAPTERS === "real"
      ? createRealDatabase(drizzle(new Pool({ connectionString: env.DATABASE_URL })))
      : createFakeDatabase().db;

  const queue: QueueClient =
    env.ADAPTERS === "real" ? createRealQueueClient(env.DATABASE_URL) : createFakeQueueClient();

  const auth: AuthAdapter = createFakeAuthAdapter().adapter;
  const storage: StorageAdapter = createFakeStorageAdapter();
  const email: EmailSender = createFakeEmailSender().sender;

  cached = { db, queue, auth, storage, email };
  return cached;
}

/** Test-only: clears the module-level cache so tests can mutate env.ADAPTERS between cases. */
export function resetAdaptersCacheForTests(): void {
  cached = undefined;
}
```

`src/jobs/worker.test.ts`'s current content — read it directly before editing (it has a `makeSpyQueue()` helper and 3 tests in `describe("startWorker", ...)` that each construct `{ db, queue }` and call `startWorker`).

- [ ] **Step 2: Write the failing tests**

Add imports to `src/jobs/worker.test.ts` (alongside its existing `createFakeDatabase` import):
```ts
import { createFakeEmailSender } from "../adapters/email/fake";
import { createFakeWhatsAppGateway } from "../adapters/whatsapp/fake";
```

Every existing `startWorker({ db, queue })` call in this file must become `startWorker({ db, queue, email, whatsapp })`, constructing fresh fakes inline, e.g.:
```ts
    const { sender: email } = createFakeEmailSender();
    const { gateway: whatsapp } = createFakeWhatsAppGateway();
    await startWorker({ db, queue, email, whatsapp });
```
Apply this to all 3 existing `startWorker(...)` call sites in the file (reproduce each test's exact surrounding code from Step 1 and add these two lines immediately before its `startWorker` call, then extend that call's argument object).

Add a new test to the `describe("startWorker", ...)` block:
```ts
  it("registers a handler for notify.send that calls deliverNotification", async () => {
    const { db } = createFakeDatabase();
    const user = await db.identity.findOrCreateUser("fb-w-notif", "wnotif@x.com", "seeker");
    const notification = await db.notifications.create({
      userId: user.id,
      template: "request.accepted",
      payload: { requestId: "r1", companyName: "Acme" },
    });
    const { queue, handlers } = makeSpyQueue();
    const { sender: email, sent } = createFakeEmailSender();
    const { gateway: whatsapp } = createFakeWhatsAppGateway();

    await startWorker({ db, queue, email, whatsapp });
    await handlers["notify.send"]({ notificationId: notification.id });

    expect(sent).toHaveLength(1);
    const updated = await db.notifications.getById(notification.id);
    expect(updated?.status).toBe("sent");
  });
```

Update `src/jobs/run-worker.ts`'s destructuring of `getAdapters()` and its `startWorker` call in the same way (see Step 4 below for the exact new file content).

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/jobs/worker.test.ts`
Expected: FAIL — `startWorker`'s `WorkerDeps` doesn't require/accept `email`/`whatsapp` yet, and there is no `notify.send` handler.

- [ ] **Step 4: Implement `src/jobs/worker.ts`**

Replace the entire file with:
```ts
import { z } from "zod";
import type { Database } from "../adapters/db/types";
import type { QueueClient } from "./queue";
import type { EmailSender } from "../adapters/email/types";
import type { WhatsAppGateway } from "../adapters/whatsapp/types";
import { expire, sweepExpiredSent, type RequestsDeps } from "../modules/requests/requests";
import { deliverNotification, type DeliveryDeps } from "../modules/notifications/notifications";

export interface WorkerDeps {
  db: Database;
  queue: QueueClient;
  email: EmailSender;
  whatsapp: WhatsAppGateway;
}

const requestExpirePayloadSchema = z.object({ requestId: z.string().min(1) });
const notifySendPayloadSchema = z.object({ notificationId: z.string().min(1) });

export async function startWorker(deps: WorkerDeps): Promise<void> {
  const requestsDeps: RequestsDeps = { db: deps.db, queue: deps.queue };
  const deliveryDeps: DeliveryDeps = { db: deps.db, email: deps.email, whatsapp: deps.whatsapp };

  // Against the real pg-boss client, work()/schedule() call boss.createQueue()
  // internally, which requires the database connection to already be open —
  // only true after start(). start() must run before any work()/schedule()
  // registration below (see the contract note on QueueClient.start()).
  await deps.queue.start();

  await deps.queue.work("request.expire", async (payload) => {
    const { requestId } = requestExpirePayloadSchema.parse(payload);
    await expire(requestsDeps, requestId);
  });

  await deps.queue.work("requests.sweep", async () => {
    await sweepExpiredSent(requestsDeps, new Date());
  });
  await deps.queue.schedule("requests.sweep", "0 * * * *", {});

  await deps.queue.work("notify.send", async (payload) => {
    const { notificationId } = notifySendPayloadSchema.parse(payload);
    await deliverNotification(deliveryDeps, notificationId);
  });

  console.log("[worker] started with request.expire, requests.sweep, and notify.send handlers registered");
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/jobs/worker.test.ts`
Expected: PASS (4 tests: the 3 existing ones plus the new `notify.send` test).

- [ ] **Step 6: Update `src/lib/adapters.impl.ts`**

Add two imports (alongside the existing `EmailSender`/`createFakeEmailSender` ones):
```ts
import type { WhatsAppGateway } from "../adapters/whatsapp/types";
import { createFakeWhatsAppGateway } from "../adapters/whatsapp/fake";
```
Add `whatsapp` to the `Adapters` interface:
```ts
export interface Adapters {
  db: Database;
  queue: QueueClient;
  auth: AuthAdapter;
  storage: StorageAdapter;
  email: EmailSender;
  whatsapp: WhatsAppGateway;
}
```
Inside `getAdapters()`, add the fake construction and include it in the cached object:
```ts
  const email: EmailSender = createFakeEmailSender().sender;
  const whatsapp: WhatsAppGateway = createFakeWhatsAppGateway().gateway;

  cached = { db, queue, auth, storage, email, whatsapp };
  return cached;
```
(`whatsapp` always uses the fake regardless of `env.ADAPTERS`, exactly matching how `auth`/`storage`/`email` already behave — there is no `WhatsAppGateway.real.ts` in this plan.)

- [ ] **Step 7: Update `src/jobs/run-worker.ts`**

Replace the entire file with:
```ts
import { getEnv } from "../config/env";
import { getAdapters } from "../lib/adapters.impl";
import { startWorker } from "./worker";

// Fail fast rather than silently expiring nothing: if this is a production
// deploy and ADAPTERS isn't "real" (e.g. missing from the deployed .env), the
// worker would otherwise boot cleanly on in-memory fake adapters and never
// touch the real database or queue.
const env = getEnv();
if (process.env.NODE_ENV === "production" && env.ADAPTERS !== "real") {
  console.error(
    `[worker] refusing to start: NODE_ENV=production but ADAPTERS=${env.ADAPTERS} (expected "real")`
  );
  process.exit(1);
}

const { db, queue, email, whatsapp } = getAdapters();

startWorker({ db, queue, email, whatsapp }).catch((err) => {
  console.error("[worker] failed to start", err);
  process.exit(1);
});
```

- [ ] **Step 8: Verify**

Run: `npm run typecheck` — must pass.
Run: `npm run lint` — must be clean.
Run: `npm test` — full suite passes.
Run a real import smoke check to confirm `run-worker.ts` still boots cleanly under plain tsx (matching the check the Phase 1 Timers final review required — this file's `server-only` risk was already fixed by that plan, but re-confirm the new imports haven't reintroduced it):
```bash
ADAPTERS=fake NODE_ENV=development npx tsx --eval "import('./src/jobs/run-worker.ts').then(() => console.log('OK')).catch((e) => { console.error('THREW', e); process.exit(1); })"
```
Expected: prints `[worker] started with request.expire, requests.sweep, and notify.send handlers registered` followed by `OK`, and does not throw. (The worker process doesn't exit on its own since `queue.start()`'s fake never blocks — if the command hangs instead of exiting, that's fine; Ctrl-C or a short timeout wrapper is acceptable, the goal is confirming the import chain doesn't throw, not testing the process lifecycle.)

- [ ] **Step 9: Commit**

```bash
git add src/jobs/worker.ts src/jobs/worker.test.ts src/jobs/run-worker.ts src/lib/adapters.impl.ts
git commit -m "feat(jobs): register notify.send handler in the worker, wire WhatsAppGateway into the adapter factory"
```

---

## Plan Self-Review Notes

- **Spec coverage:** every section of `docs/superpowers/specs/2026-09-24-notifications-module-design.md` maps to a task — Architecture/two-phase design → Tasks 5 & 7; Components (`notifications` table, `WhatsAppGateway`, template registry, `getSeekerProfileById`, `SendOptions` extension) → Tasks 1-4; Data Flow → Task 6 (the 5 call sites) + Task 7 (the worker handler); Error Handling → pinned by Task 5's and Task 6's tests; Testing → each task's own test file. The spec's "Open items carried to the plan" (migration numbering, exact copy) are resolved directly in Task 3 (numbering) and Task 4 (copy).
- **Type consistency, checked field-for-field across tasks:** `SendOptions.retryLimit`/`retryBackoff` (Task 1) are used identically in `notify()`'s `queue.send` call (Task 5) and asserted identically in Task 5's own test. `WhatsAppGateway`'s three method signatures (Task 2) are called identically in `deliverNotification` (Task 5) and mocked identically in Task 5's/Task 7's tests. `NotificationRecord`/`NotificationChannel`/`CreateNotificationInput` (Task 3) are used identically by `notify()`/`deliverNotification()` (Task 5) and by the `fake.ts`/`real.ts` implementations (Task 3 itself). `TemplateName`/`TemplateDefinition` (Task 4) are consumed identically by `notify()`'s `templates[template]` lookup and `deliverNotification`'s `templates[record.template as TemplateName]` lookup (Task 5). `AdminDeps` gaining `queue: QueueClient` (Task 6) matches the exact type `RequestsDeps` already uses, confirmed structurally compatible with `NotifyDeps`. `DeliveryDeps` (Task 5) is constructed identically in `worker.ts` (Task 7) from `WorkerDeps`'s new `email`/`whatsapp` fields.
- **Cross-file check on `admin.test.ts` (mirrors the Phase 1 Timers plan's own self-review discipline):** confirmed during plan authoring that `admin.test.ts` has exactly one bare `{ db }`-shaped call — `listPendingProofs({ db })` in its second test — and that `makeProofPendingRequest`'s `deps` already includes `queue`. This is folded into Task 6's own scope, not deferred.
- **Review Focus, mapped to owning tasks:** invalid `notify()` payload → Task 5's "throws synchronously on a payload that fails the template's schema" test. No phone on file → Task 5's "skips WhatsApp entirely" test. Every channel failing → Task 5's "marks the notification failed and rethrows" test. `AdminDeps`'s `queue` ripple → Task 6's cross-file note and its fix. `expire()`'s conflict-fallback path double-notifying → Task 6's dedicated "does not send a duplicate notification when expire() hits its RequestStateConflictError fallback path" test.
- **Next plan:** `rewards` on the manual vendor (points issuance per tranche, redemption requests, the PAN gate) is the next AGENTS.md §3.11 Phase 1 item after notifications, per the ordering `... → timers → email notifications → rewards on the manual vendor → Playwright flows`. Building `rewards` will let a real `pointsEarned` figure be added to the `proof.verified` template's insider-audience copy, which this plan deliberately left out since no points-issuance logic exists yet anywhere in the codebase (adding a fabricated number would have violated AGENTS.md §0.5's "business numbers are configuration, never code" — there was no config value to read it from).

## Final review findings and deferred follow-ups

Final whole-branch review (opus): no Critical or Important findings; ready to merge after the small fixes in the accompanying commit (unused `NotificationChannel` imports removed, stale `adapters.impl.ts` comment refreshed to include whatsapp).

**HARD GATE before any real `EmailSender` or real `WhatsAppGateway` is wired** (all three must land first; today both are fakes so none of these can cause real-world harm yet):
- (a) Event-derived idempotency for notifications (AGENTS.md Part 2.4). `applyTransition`'s idempotent-replay branch (`src/adapters/db/real.ts` and the fake) returns the current row silently, so a racing second caller of accept/decline/expire/reviewProof can re-notify. Fix: additive migration 0010 adding a unique `notifications.idempotency_key`; `create` uses `ON CONFLICT DO NOTHING` (fake and real); an optional key param on `notify()`; event-derived keys at the 5 call sites (e.g. `request:{id}:accept:notify:{template}:{audience}`).
- (b) Outbox/sweep. `notify()` creates the `notifications` row before `queue.send`, so a failed send leaves an orphan `pending` row with no job. Add a sweep (or outbox) that re-enqueues old `pending` rows.
- (c) `deliverNotification` throws without `markFailed` for an unknown template, an unparseable stored payload, or a missing user (the row stays `pending` across retries), and WhatsApp failure causes are dropped (only the email error is stored). Wrap and record these.

**Before launch:** real Brevo `EmailSender` and real `WhatsAppGateway`. Until then the fakes are used even under `ADAPTERS=real`, so rows are marked `status=sent` without any delivery, and the fake email `sent` array grows without bound in a long-running worker (it holds recipient addresses and HTML).

**Real Brevo adapter requirements:** strip CR/LF from the subject (subjects contain user-controlled `seekerName`), and make sure error text never contains the API key.

**Other deferred items:**
- The refund formula `Math.round(creditCost * pct / 100)` is duplicated in `requests.ts` (`refundEntries`, and the decline/expire notify blocks). Extract a `refundAmountFor` helper so the ledger and email copy cannot drift.
- When Seeker onboarding lands, require `fullName` `min(1)` and trim in the Seeker profile schema. An empty `fullName` currently makes `proof.verified` (insider) and `proof.rejected` notifications fail Zod and be dropped with only a `console.error`.
- Minor: `templates.test.ts` asserts the literal `/GetNudgd/` instead of `brand.name`; `retryLimit: 3` in `notifications.ts` is a literal (make it a named constant); real `markSent`/`markFailed` no-op on a missing id while the fake throws (existing repo pattern).

**Task 7 note:** migration 0009 was confirmed by inspection (matches `schema.ts` and the snapshot; no trigger/REVOKE; `db:generate` reports no changes). Applying it to a live Postgres is still unverified.
