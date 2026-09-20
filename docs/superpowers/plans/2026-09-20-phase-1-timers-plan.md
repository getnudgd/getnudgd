# Phase 1 Timers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the `request.expire` and `requests.sweep` pg-boss jobs so a `SENT` Insider Request actually expires on its own after the configured response window, instead of `expire()` sitting built-and-tested-but-never-called. This is the "timers" item in AGENTS.md §3.11's Phase 1 backend backlog, immediately after the already-merged proof/admin-verify work.

**Architecture:** `Database`'s existing `requests.expire` module function (built two plans ago, idempotent, config-driven) is the target of two new pg-boss job registrations in `src/jobs/worker.ts`: a delayed, singleton-keyed `request.expire` job enqueued by `sendRequest` itself at send time (fires once, 48h — configurable — after the request is sent, no-ops if the request already moved on), and an hourly cron `requests.sweep` job that re-scans all `SENT` requests and expires any whose deadline has passed, as a safety net for a lost or never-fired timer (matching AGENTS.md §3.4's stated purpose for `requests.sweep`). This requires extending the `QueueClient` adapter interface (built in Phase 0, never used until now) with delay/singleton options on `send` and a new `schedule` method for the cron registration — pg-boss already supports both, the interface just never exposed them.

**Tech Stack:** pg-boss (already a dependency, `SendOptions`/`ScheduleOptions`/`schedule()` confirmed present in `node_modules/pg-boss/dist/types.d.ts` and `index.d.ts`) — no new dependencies.

**Spec:** `AGENTS.md` at the repo root — specifically §3.4 (the jobs table: `request.expire`'s trigger/key/notes, `requests.sweep`'s trigger/key/notes), §2.4 (idempotency — `request:{id}:expire` is the exact key AGENTS.md's own table already names). The `requests.expire` module function, `Database.requests.listByState`, and the `src/lib/adapters.ts` factory (which now supplies both `db` and `queue` together) already exist from prior merged plans and are consumed, not rebuilt, here.

## Global Constraints

- TypeScript strict, no `any`, no `@ts-ignore`; Zod at every boundary (Part 2.1) — not applicable to this plan's own new code (no new external input boundary), but nothing here may introduce one that lacks it.
- Domain modules (`src/modules/requests`) import no Next.js, no Drizzle, no vendor SDK — only `Database`/`QueueClient` via a `deps` object (Part 2.2). `QueueClient` is itself an adapter interface, not a vendor SDK import — `requests.ts` already imports adapter interfaces (`Database`), and `QueueClient` is the same kind of thing.
- Every vendor is behind an interface with a fake (Part 2.3) — `QueueClient`'s interface extension gets both `fake.ts` and `real.ts` implementations in the same task.
- Idempotency on anything that moves money or sends a message (Part 2.4) — `request.expire`'s job payload send uses `singletonKey: request:{id}:expire`, the exact key AGENTS.md §3.4 already specifies; `expire()` itself is already idempotent (built in a prior plan).
- Jobs never call each other synchronously; they enqueue (§3.4) — not violated here: `sendRequest` enqueues, it never awaits job completion.
- Every job handler is idempotent and re-checks current state before acting (§3.4) — already true of `expire()`; this plan doesn't weaken that.
- Small, verified commits with `type(scope): summary` commit messages; run `npm run lint && npm run typecheck && npm test` before every commit (Part 2.10).
- Do not add dependencies (Part 2.11) — this plan adds none; pg-boss's `send`/`schedule` options are already present in the installed version.
- Locked vocabulary: Insider, Seeker, Insider Request — never "referrer" (§0.4).
- No live Postgres/pg-boss is required to execute this plan's tasks (the fake `QueueClient` covers all module-level tests); if a local Postgres is reachable in your environment, verifying `queue.real.ts`'s `send`/`schedule` against it is welcome but not required, matching every prior plan's precedent for `real.ts` files.

---

## Task 1: Extend `QueueClient` with delay/singleton send options and a `schedule` method

**Files:**
- Modify: `src/jobs/queue.ts`
- Modify: `src/jobs/queue.fake.ts`
- Modify: `src/jobs/queue.fake.test.ts`
- Modify: `src/jobs/queue.real.ts`

**Interfaces:**
- Produces: `SendOptions` type, `QueueClient.send`'s new optional third parameter, `QueueClient.schedule(queueName, cron, payload)` — consumed by Task 2's `sendRequest`/`sweepExpiredSent` and Task 3's `worker.ts`.

- [ ] **Step 1: Read the current `QueueClient` interface**

`src/jobs/queue.ts` currently reads exactly:
```ts
export interface JobHandler<T = unknown> {
  (payload: T): Promise<void>;
}

export interface QueueClient {
  start(): Promise<void>;
  stop(): Promise<void>;
  send(queueName: string, payload: unknown): Promise<string | null>;
  work(queueName: string, handler: JobHandler): Promise<void>;
}
```
Replace it with:
```ts
export interface JobHandler<T = unknown> {
  (payload: T): Promise<void>;
}

export interface SendOptions {
  singletonKey?: string;
  startAfterSeconds?: number;
}

export interface QueueClient {
  start(): Promise<void>;
  stop(): Promise<void>;
  send(queueName: string, payload: unknown, options?: SendOptions): Promise<string | null>;
  work(queueName: string, handler: JobHandler): Promise<void>;
  schedule(queueName: string, cron: string, payload: unknown): Promise<void>;
}
```

- [ ] **Step 2: Write the failing tests**

`src/jobs/queue.fake.test.ts` currently has two tests (`"returns null and does not enqueue when send is called before start"`, `"delivers sent payloads to a registered handler once started"`) — leave both exactly as they are (the new `options` parameter is optional, so they keep compiling and passing unchanged). Add these two new tests to the same `describe("createFakeQueueClient", ...)` block:
```ts
  it("accepts SendOptions without erroring and still delivers the payload", async () => {
    const queue = createFakeQueueClient();
    const handler = vi.fn(async () => {});
    await queue.work("request.expire", handler);
    await queue.start();
    const jobId = await queue.send(
      "request.expire",
      { requestId: "r1" },
      { singletonKey: "request:r1:expire", startAfterSeconds: 172800 }
    );
    expect(jobId).not.toBeNull();
    expect(handler).toHaveBeenCalledWith({ requestId: "r1" });
  });

  it("schedule does not throw and does not require start", async () => {
    const queue = createFakeQueueClient();
    await expect(queue.schedule("requests.sweep", "0 * * * *", {})).resolves.toBeUndefined();
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/jobs/queue.fake.test.ts`
Expected: FAIL — `queue.schedule` doesn't exist yet on the fake.

- [ ] **Step 4: Implement in `src/jobs/queue.fake.ts`**

Current file:
```ts
import type { QueueClient, JobHandler } from "./queue";

export function createFakeQueueClient(): QueueClient {
  const queues: Record<string, unknown[]> = {};
  const handlers: Record<string, JobHandler> = {};
  let started = false;

  return {
    async start() {
      started = true;
    },
    async stop() {
      started = false;
    },
    async send(queueName, payload) {
      if (!started) return null;
      (queues[queueName] ??= []).push(payload);
      const handler = handlers[queueName];
      if (handler) await handler(payload);
      return `fake-job-${queues[queueName].length}`;
    },
    async work(queueName, handler) {
      handlers[queueName] = handler;
    },
  };
}
```
Replace with:
```ts
import type { QueueClient, JobHandler, SendOptions } from "./queue";

export function createFakeQueueClient(): QueueClient {
  const queues: Record<string, unknown[]> = {};
  const handlers: Record<string, JobHandler> = {};
  let started = false;

  return {
    async start() {
      started = true;
    },
    async stop() {
      started = false;
    },
    async send(queueName, payload, _options?: SendOptions) {
      if (!started) return null;
      (queues[queueName] ??= []).push(payload);
      const handler = handlers[queueName];
      if (handler) await handler(payload);
      return `fake-job-${queues[queueName].length}`;
    },
    async work(queueName, handler) {
      handlers[queueName] = handler;
    },
    async schedule(_queueName, _cron, _payload) {
      // The fake has no real cron scheduler — recording the registration is
      // enough for tests to verify wiring; the sweep job's actual LOGIC is
      // tested directly as a plain async function call, not through this.
    },
  };
}
```
(The fake deliberately ignores `startAfterSeconds`/`singletonKey` and still dispatches immediately, matching its existing always-immediate design — delayed/deduplicated execution is a `real.ts` concern, not something worth simulating in a synchronous test double. `_options`/`_queueName`/`_cron`/`_payload` are prefixed with `_` since they're intentionally unused parameters — this matches this codebase's lint configuration, which allows unused parameters with a leading underscore.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/jobs/queue.fake.test.ts`
Expected: PASS (4 tests: 2 existing + 2 new).

- [ ] **Step 6: Implement in `src/jobs/queue.real.ts`**

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
    async send(queueName, payload) {
      await boss.createQueue(queueName);
      return boss.send(queueName, payload as object);
    },
    async work(queueName, handler) {
      await boss.createQueue(queueName);
      await boss.work(queueName, async (jobs) => {
        for (const job of jobs) {
          await handler(job.data);
        }
      });
    },
  };
}
```
Replace with:
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
(pg-boss's `send(name, data, options)` and `schedule(name, cron, data, options)` signatures, and the `SendOptions.singletonKey`/`startAfter` field names, are already confirmed present in `node_modules/pg-boss/dist/types.d.ts` and `index.d.ts` in this repo — no version upgrade needed.)

- [ ] **Step 7: Verify**

Run: `npm run typecheck` — must pass.
Run: `npm run lint` — must be clean.
Run: `npm test` — full suite passes.

- [ ] **Step 8: Commit**

```bash
git add src/jobs/queue.ts src/jobs/queue.fake.ts src/jobs/queue.fake.test.ts src/jobs/queue.real.ts
git commit -m "feat(jobs): add delay/singleton send options and schedule() to QueueClient"
```

---

## Task 2: `sendRequest` enqueues its own expiry, plus `sweepExpiredSent`

**Files:**
- Modify: `src/modules/requests/requests.ts`
- Modify: `src/modules/requests/requests.test.ts`
- Modify: `src/modules/admin/admin.test.ts`

**Interfaces:**
- Consumes: `QueueClient`, `SendOptions` from `../../jobs/queue` (Task 1); `createFakeQueueClient` from `../../jobs/queue.fake` (test-only).
- Produces: `RequestsDeps` gains a required `queue: QueueClient` field; a new exported `sweepExpiredSent(deps, now)` function — consumed by Task 3's `worker.ts`.

**Cross-file note:** `RequestsDeps` becoming required-`queue` breaks typecheck for every existing `{ db }`-only construction of it, not just in `requests.test.ts`. `src/modules/admin/admin.test.ts`'s `makeProofPendingRequest` helper (which calls `sendRequest`/`accept`/`submitProof`) has exactly one such site — confirmed by reading the live file: `admin.test.ts:3` imports `sendRequest, accept, submitProof, type RequestsDeps` from `../requests/requests`, and `admin.test.ts:40` reads `const deps = { db };`. Fix this in the same task, alongside the `requests.test.ts` changes below — do not leave it for a later task or it will silently break Task 2's own typecheck gate.

- [ ] **Step 1: Read the current `RequestsDeps` and `sendRequest`**

`src/modules/requests/requests.ts` currently starts:
```ts
import type { Database, InsiderRequestRecord, PostLedgerEntryInput } from "../../adapters/db/types";
import { RequestStateConflictError } from "../../adapters/db/types";
import { getRulesWithVersion } from "../config/config";
import { UnknownCompanyTierError } from "../insiders/insiders";
import { escrowFor, platformAccount } from "../ledger/ledger";
import { nextState, type RequestState } from "./state";

export interface RequestsDeps {
  db: Database;
}
```
and `sendRequest`'s current body ends with:
```ts
  const { rules, version: rulesVersion } = await getRulesWithVersion(deps);
  const creditCost = rules.requestCostByTier[summary.companyTier];
  if (creditCost === undefined) throw new UnknownCompanyTierError(summary.companyTier);

  return deps.db.requests.sendRequest({
    idempotencyKey: `send:${input.idempotencyKey}`,
    seekerProfileId: input.seekerProfileId,
    insiderProfileId: input.insiderProfileId,
    companyId: profile.companyId,
    creditCost,
    rulesVersion,
  });
}
```

- [ ] **Step 2: Write the failing tests**

Add `createFakeQueueClient` to the existing `import { createFakeDatabase } from "../../adapters/db/fake";` area of `requests.test.ts` — add a new import line:
```ts
import { createFakeQueueClient } from "../../jobs/queue.fake";
import type { QueueClient } from "../../jobs/queue";
```

Change `makeVerifiedInsiderAndFundedSeeker`'s final return line from:
```ts
  return { deps: { db }, seekerProfileId: seekerProfile.id, insiderProfileId: insiderProfile.id };
```
to:
```ts
  return { deps: { db, queue: createFakeQueueClient() }, seekerProfileId: seekerProfile.id, insiderProfileId: insiderProfile.id };
```
(Check the exact current return statement text in the file before editing — reproduce this exact change, don't guess at surrounding lines.)

Find the two standalone `const deps = { db };` lines elsewhere in this file (used by the two "rules_version" regression tests that don't go through the shared helper) and change each to:
```ts
    const deps = { db, queue: createFakeQueueClient() };
```

In `src/modules/admin/admin.test.ts`, add `createFakeQueueClient` to its imports (add a new line: `import { createFakeQueueClient } from "../../jobs/queue.fake";`) and change the single `const deps = { db };` line (inside `makeProofPendingRequest`) to:
```ts
  const deps = { db, queue: createFakeQueueClient() };
```

Add these new tests inside the existing `describe("sendRequest", ...)` block:
```ts
  it("enqueues a request.expire job with a singleton key and the configured response window", async () => {
    const sentJobs: Array<{ queueName: string; payload: unknown; options?: { singletonKey?: string; startAfterSeconds?: number } }> = [];
    const spyQueue: QueueClient = {
      async start() {},
      async stop() {},
      async send(queueName, payload, options) {
        sentJobs.push({ queueName, payload, options });
        return "job-1";
      },
      async work() {},
      async schedule() {},
    };
    const { db, seedConfig, seedCompany } = createFakeDatabase();
    seedConfig({ key: "rules", version: 1, placeholder: true, value: RULES_VALUE });
    const company = seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const seekerUser = await db.identity.findOrCreateUser("fb-eq-1", "eq1@x.com", "seeker");
    const seekerProfile = await db.identity.createSeekerProfile(seekerUser.id, "EQ Seeker");
    await db.ledger.postTxn({
      idempotencyKey: "grant:eq1",
      eventType: "credits.grant",
      entries: [
        { ownerType: "platform", ownerId: "platform", currency: "credits", amount: -5 },
        { ownerType: "seeker", ownerId: seekerProfile.id, currency: "credits", amount: 5 },
      ],
    });
    const insiderUser = await db.identity.findOrCreateUser("fb-eq-2", "eq2@acme.com", "seeker");
    const insiderProfile = await db.identity.findOrCreateInsiderProfile(insiderUser.id, company.id, "eq2@acme.com");
    await db.identity.markInsiderVerified(insiderProfile.id, new Date());

    const request = await sendRequest(
      { db, queue: spyQueue },
      { idempotencyKey: "eq1", seekerProfileId: seekerProfile.id, insiderProfileId: insiderProfile.id }
    );

    expect(sentJobs).toHaveLength(1);
    expect(sentJobs[0].queueName).toBe("request.expire");
    expect(sentJobs[0].payload).toEqual({ requestId: request.id });
    expect(sentJobs[0].options?.singletonKey).toBe(`request:${request.id}:expire`);
    expect(sentJobs[0].options?.startAfterSeconds).toBe(RULES_VALUE.responseWindowHours * 3600);
  });
```

Add a new top-level `describe` block for the sweep function:
```ts
describe("sweepExpiredSent", () => {
  it("expires a SENT request whose response window has passed, refunding per config", async () => {
    const { deps, seekerProfileId, insiderProfileId } = await makeVerifiedInsiderAndFundedSeeker(5);
    const request = await sendRequest(deps, { idempotencyKey: "sw1", seekerProfileId, insiderProfileId });
    const past = new Date(Date.now() + (RULES_VALUE.responseWindowHours * 3600 + 60) * 1000);

    const swept = await sweepExpiredSent(deps, past);

    expect(swept.map((r) => r.id)).toContain(request.id);
    const updated = await deps.db.requests.getById(request.id);
    expect(updated?.state).toBe("EXPIRED");
    expect(await deps.db.ledger.getBalance("seeker", seekerProfileId, "credits")).toBe(5);
  });

  it("does not sweep a SENT request still within its response window", async () => {
    const { deps, seekerProfileId, insiderProfileId } = await makeVerifiedInsiderAndFundedSeeker(5);
    const request = await sendRequest(deps, { idempotencyKey: "sw2", seekerProfileId, insiderProfileId });
    const soon = new Date(Date.now() + 60 * 1000);

    const swept = await sweepExpiredSent(deps, soon);

    expect(swept.map((r) => r.id)).not.toContain(request.id);
    const updated = await deps.db.requests.getById(request.id);
    expect(updated?.state).toBe("SENT");
  });

  it("does not touch a request that is no longer SENT, even if old", async () => {
    const { deps, seekerProfileId, insiderProfileId } = await makeVerifiedInsiderAndFundedSeeker(5);
    const request = await sendRequest(deps, { idempotencyKey: "sw3", seekerProfileId, insiderProfileId });
    await accept(deps, request.id);
    const past = new Date(Date.now() + (RULES_VALUE.responseWindowHours * 3600 + 60) * 1000);

    const swept = await sweepExpiredSent(deps, past);

    expect(swept.map((r) => r.id)).not.toContain(request.id);
    const updated = await deps.db.requests.getById(request.id);
    expect(updated?.state).toBe("ACCEPTED");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/modules/requests/requests.test.ts`
Expected: FAIL — `RequestsDeps` requires `queue` (typecheck failure) and `sweepExpiredSent` doesn't exist yet.

- [ ] **Step 4: Implement in `src/modules/requests/requests.ts`**

Change the import line and `RequestsDeps` from:
```ts
import type { Database, InsiderRequestRecord, PostLedgerEntryInput } from "../../adapters/db/types";
import { RequestStateConflictError } from "../../adapters/db/types";
import { getRulesWithVersion } from "../config/config";
import { UnknownCompanyTierError } from "../insiders/insiders";
import { escrowFor, platformAccount } from "../ledger/ledger";
import { nextState, type RequestState } from "./state";

export interface RequestsDeps {
  db: Database;
}
```
to:
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

Change `sendRequest`'s ending from:
```ts
  return deps.db.requests.sendRequest({
    idempotencyKey: `send:${input.idempotencyKey}`,
    seekerProfileId: input.seekerProfileId,
    insiderProfileId: input.insiderProfileId,
    companyId: profile.companyId,
    creditCost,
    rulesVersion,
  });
}
```
to:
```ts
  const request = await deps.db.requests.sendRequest({
    idempotencyKey: `send:${input.idempotencyKey}`,
    seekerProfileId: input.seekerProfileId,
    insiderProfileId: input.insiderProfileId,
    companyId: profile.companyId,
    creditCost,
    rulesVersion,
  });

  await deps.queue.send(
    "request.expire",
    { requestId: request.id },
    { singletonKey: `request:${request.id}:expire`, startAfterSeconds: rules.responseWindowHours * 3600 }
  );

  return request;
}
```

Add this new exported function anywhere after `expire` (the last function in the file):
```ts
export async function sweepExpiredSent(deps: RequestsDeps, now: Date): Promise<InsiderRequestRecord[]> {
  const { rules } = await getRulesWithVersion(deps);
  const deadlineMs = rules.responseWindowHours * 3600 * 1000;
  const sentRequests = await deps.db.requests.listByState("SENT");
  const overdue = sentRequests.filter((r) => now.getTime() - r.createdAt.getTime() >= deadlineMs);

  const results: InsiderRequestRecord[] = [];
  for (const request of overdue) {
    results.push(await expire(deps, request.id));
  }
  return results;
}
```
(`sweepExpiredSent` uses the CURRENT config's `responseWindowHours` only to decide which requests are stale enough to sweep — a safety-net threshold, not a money calculation. The actual refund math inside `expire()` already correctly uses each request's own stamped `rules_version`, per the fix from a prior plan; this function doesn't touch that. Requests are expired sequentially, not in parallel, to avoid opening many concurrent DB transactions from one sweep pass — acceptable at MVP volume, matching this codebase's existing tolerance for non-parallelized batch operations.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/modules/requests/requests.test.ts src/modules/admin/admin.test.ts`
Expected: PASS. `requests.test.ts` gains 4 new tests (1 in `sendRequest`'s describe block, 3 in the new `sweepExpiredSent` describe block); `admin.test.ts`'s existing tests should be unaffected in count, just no longer fail to typecheck.
Run: `npm test` — full suite passes.
Run: `npm run typecheck` and `npm run lint` — both clean.

- [ ] **Step 6: Commit**

```bash
git add src/modules/requests src/modules/admin/admin.test.ts
git commit -m "feat(requests): enqueue request.expire on send, add sweepExpiredSent"
```

---

## Task 3: Wire `src/jobs/worker.ts` to register both handlers, update `run-worker.ts`

**Files:**
- Modify: `src/jobs/worker.ts`
- Create: `src/jobs/worker.test.ts`
- Modify: `src/jobs/run-worker.ts`

**Interfaces:**
- Consumes: `expire`, `sweepExpiredSent`, `type RequestsDeps` from `../modules/requests/requests` (Task 2); `getAdapters` from `../lib/adapters` (already on main, built earlier this session).
- Produces: `startWorker`'s new signature `startWorker(deps: { db: Database; queue: QueueClient }): Promise<void>`.

- [ ] **Step 1: Read the current `worker.ts` and `run-worker.ts`**

`src/jobs/worker.ts` currently reads exactly:
```ts
import type { QueueClient } from "./queue";

export async function startWorker(queue: QueueClient): Promise<void> {
  await queue.start();
  console.log("[worker] started, no job handlers registered yet (Phase 1+)");
}
```

`src/jobs/run-worker.ts` currently reads exactly:
```ts
import { getEnv } from "../config/env";
import { createRealQueueClient } from "./queue.real";
import { startWorker } from "./worker";

const env = getEnv();
const queue = createRealQueueClient(env.DATABASE_URL);

startWorker(queue).catch((err) => {
  console.error("[worker] failed to start", err);
  process.exit(1);
});
```
There is also `src/jobs/worker.test.ts`, currently testing the old zero-argument-style `startWorker(queue)` — check its exact current content before editing, since Step 4 replaces this file entirely rather than patching it (the signature change means every existing test in it needs rewriting anyway).

- [ ] **Step 2: Write the failing tests**

Replace the entire contents of `src/jobs/worker.test.ts` with:
```ts
import { describe, it, expect } from "vitest";
import { createFakeDatabase } from "../adapters/db/fake";
import type { QueueClient, JobHandler } from "./queue";
import { startWorker } from "./worker";

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

function makeSpyQueue(): {
  queue: QueueClient;
  handlers: Record<string, JobHandler>;
  scheduled: Array<{ queueName: string; cron: string }>;
} {
  const handlers: Record<string, JobHandler> = {};
  const scheduled: Array<{ queueName: string; cron: string }> = [];
  const queue: QueueClient = {
    async start() {},
    async stop() {},
    async send() {
      return null;
    },
    async work(queueName, handler) {
      handlers[queueName] = handler;
    },
    async schedule(queueName, cron) {
      scheduled.push({ queueName, cron });
    },
  };
  return { queue, handlers, scheduled };
}

describe("startWorker", () => {
  it("registers a handler for request.expire and requests.sweep, and schedules the sweep cron hourly", async () => {
    const { db } = createFakeDatabase();
    const { queue, handlers, scheduled } = makeSpyQueue();

    await startWorker({ db, queue });

    expect(handlers["request.expire"]).toBeDefined();
    expect(handlers["requests.sweep"]).toBeDefined();
    expect(scheduled).toContainEqual({ queueName: "requests.sweep", cron: "0 * * * *" });
  });

  it("request.expire handler calls expire() for the given requestId", async () => {
    const { db, seedConfig, seedCompany } = createFakeDatabase();
    seedConfig({ key: "rules", version: 1, placeholder: true, value: RULES_VALUE });
    const company = seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const seekerUser = await db.identity.findOrCreateUser("fb-w-1", "w1@x.com", "seeker");
    const seekerProfile = await db.identity.createSeekerProfile(seekerUser.id, "Worker Seeker");
    await db.ledger.postTxn({
      idempotencyKey: "grant:w1",
      eventType: "credits.grant",
      entries: [
        { ownerType: "platform", ownerId: "platform", currency: "credits", amount: -5 },
        { ownerType: "seeker", ownerId: seekerProfile.id, currency: "credits", amount: 5 },
      ],
    });
    const insiderUser = await db.identity.findOrCreateUser("fb-w-2", "w2@acme.com", "seeker");
    const insiderProfile = await db.identity.findOrCreateInsiderProfile(insiderUser.id, company.id, "w2@acme.com");
    await db.identity.markInsiderVerified(insiderProfile.id, new Date());
    const request = await db.requests.sendRequest({
      idempotencyKey: "send:w1",
      seekerProfileId: seekerProfile.id,
      insiderProfileId: insiderProfile.id,
      companyId: company.id,
      creditCost: 3,
      rulesVersion: 1,
    });

    const { queue, handlers } = makeSpyQueue();
    await startWorker({ db, queue });
    await handlers["request.expire"]({ requestId: request.id });

    const updated = await db.requests.getById(request.id);
    expect(updated?.state).toBe("EXPIRED");
  });

  it("requests.sweep handler is a no-op when there are no overdue requests", async () => {
    const { db, seedConfig } = createFakeDatabase();
    seedConfig({ key: "rules", version: 1, placeholder: true, value: RULES_VALUE });
    const { queue, handlers } = makeSpyQueue();

    await startWorker({ db, queue });

    await expect(handlers["requests.sweep"]({})).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/jobs/worker.test.ts`
Expected: FAIL — `startWorker` still takes a single `QueueClient` argument, not `{ db, queue }`.

- [ ] **Step 4: Implement `src/jobs/worker.ts`**

Replace the entire file with:
```ts
import type { Database } from "../adapters/db/types";
import type { QueueClient } from "./queue";
import { expire, sweepExpiredSent, type RequestsDeps } from "../modules/requests/requests";

export interface WorkerDeps {
  db: Database;
  queue: QueueClient;
}

export async function startWorker(deps: WorkerDeps): Promise<void> {
  const requestsDeps: RequestsDeps = { db: deps.db, queue: deps.queue };

  await deps.queue.work("request.expire", async (payload) => {
    const { requestId } = payload as { requestId: string };
    await expire(requestsDeps, requestId);
  });

  await deps.queue.work("requests.sweep", async () => {
    await sweepExpiredSent(requestsDeps, new Date());
  });
  await deps.queue.schedule("requests.sweep", "0 * * * *", {});

  await deps.queue.start();
  console.log("[worker] started with request.expire and requests.sweep handlers registered");
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/jobs/worker.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Update `src/jobs/run-worker.ts`**

Replace the entire file with:
```ts
import { getAdapters } from "../lib/adapters";
import { startWorker } from "./worker";

const { db, queue } = getAdapters();

startWorker({ db, queue }).catch((err) => {
  console.error("[worker] failed to start", err);
  process.exit(1);
});
```
(`getAdapters()` — built in the plan immediately before this one — is the single place the app picks real vs. fake `db`/`queue` based on `env.ADAPTERS`. Using it here instead of hand-constructing a `createRealQueueClient` directly means the worker process and the web process now share the exact same adapter-selection logic, closing a small inconsistency: previously `run-worker.ts` was hardcoded to always use the real queue client regardless of `ADAPTERS`, while every other part of the app that used adapters went through fakes by default.)

- [ ] **Step 7: Verify**

Run: `npm run typecheck` — must pass.
Run: `npm run lint` — must be clean.
Run: `npm test` — full suite passes.

- [ ] **Step 8: Commit**

```bash
git add src/jobs/worker.ts src/jobs/worker.test.ts src/jobs/run-worker.ts
git commit -m "feat(jobs): register request.expire and requests.sweep handlers in the worker"
```

---

## Plan Self-Review Notes

- **Spec coverage:** AGENTS.md §3.4's `request.expire` row (trigger: request sent, delayed 48h/config; key: `request:{id}:expire`; note: no-op unless still SENT) and `requests.sweep` row (trigger: cron hourly; key: singleton; note: catches overdue requests whose timer job was lost) are both fully implemented. The other §3.4 jobs (`resume.parse`, `resume.tailor`, `request.windowClose`, `insider.reverify`, `insider.weeklyReset`, `notify.send`, `payments.reconcile`, `ledger.reconcile`) are deliberately out of scope — each depends on a module that doesn't exist yet (resume pipeline, interview confirmation, notifications, Razorpay, or — for `insider.weeklyReset` — a weekly-limit enforcement design that was already flagged as not yet decided in the prior plan's self-review).
- **Deliberately deferred, with rationale stated inline:** `insider.reverify` and `insider.weeklyReset` need backend pieces (an "hide profile" function, a real weekly-counter enforcement) that don't exist; both are natural candidates for a dedicated future plan once those modules are designed.
- **Type consistency:** `SendOptions` (Task 1) is used identically by `fake.ts`, `real.ts`, and `requests.ts`'s `sendRequest` call (Task 2) — checked field-for-field (`singletonKey`, `startAfterSeconds`). `RequestsDeps`'s new `queue` field is required (not optional), so every existing caller of `sendRequest`/`accept`/`decline`/`expire`/`submitProof` across `requests.test.ts` and `admin.test.ts` needs a `queue` in its deps — Task 2's brief identifies every construction site in `requests.test.ts` by exact text; `admin.test.ts` also constructs `RequestsDeps`-shaped objects (via its own `makeProofPendingRequest` helper) and will need the same one-line fix, called out explicitly so the implementer doesn't miss it.
- **Cross-file check on admin.test.ts:** confirmed during plan authoring that `admin.test.ts`'s `makeProofPendingRequest` helper builds `const deps = { db };` and calls `sendRequest`/`accept`/`submitProof` — this will fail to typecheck once `RequestsDeps` requires `queue`. **This is folded into Task 2's scope**, not a separate task: Task 2's implementer must also update `src/modules/admin/admin.test.ts`'s one `const deps = { db };` line (and its import list) the same way as `requests.test.ts`'s — add this file to Task 2's Files list before dispatching, and add `createFakeQueueClient`/`queue` to that one construction site.
- **Next plan:** email notifications (the `notifications` module, `notify.send` job) is the next AGENTS.md §3.11 Phase 1 item after timers, followed by `rewards` on the manual vendor, then Playwright flows for the three critical paths (§3.8) — by that point Flow A (send → accept → proof → verify → interview) still needs interview confirmation built first, matching the gap already flagged in `USER-FLOWS.md` §8.2.
