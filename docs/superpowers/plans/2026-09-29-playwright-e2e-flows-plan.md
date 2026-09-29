# Playwright Critical-Flow E2E Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Flow B (send→decline→refund) and Flow C (send→expire→refund) fully as Playwright end-to-end tests against the real dev Postgres + a real in-process worker, and Flow A (send→accept→proof→verify, including tranche-1 rewards) partially, with its interview leg marked `test.fixme()` pending the not-yet-built interview-confirmation feature.

**Architecture:** Playwright is the test runner named in `AGENTS.md` §3.8/§8, but with no browser and no HTTP: every flow drives the system by calling the real module functions (`sendRequest`, `accept`, `decline`, `expire`, `submitProof`, `admin.reviewProof`) against real adapters (`createRealDatabase`, `createRealQueueClient`), with a real in-process worker (`startWorker`) delivering notifications through fake email/WhatsApp adapters. This is the same pattern already proven in this repo's three `*.live.test.ts` files, generalized from single-module checks into full multi-step business flows.

**Tech Stack:** `@playwright/test` (new devDependency). No other new dependencies — reuses this repo's existing `pg`, `drizzle-orm`, and every adapter/module already built.

**Spec:** `docs/superpowers/specs/2026-09-29-playwright-e2e-flows-design.md` (revised 2026-09-29 after an opus design review — the spec's §2 records two decisions the founder already made; do not reopen them).

## Global Constraints

- No UI or `/api/v1` route is built or needed (spec §2 decision 1). Every flow drives the system through direct calls to existing module functions.
- Every credit or points amount a test asserts is **computed from the request's own stamped `rulesVersion`** (`getRulesWithVersion({ db }, request.rulesVersion)`), never a literal percentage or amount — `sendRequest` always stamps whatever `getLatest("rules")` returns at send time, which changes as new rules versions are seeded (spec §4.3/§7, "C1").
- `playwright.config.ts` must set `workers: 1` and `fullyParallel: false` — this is load-bearing (spec §4.2): `startWorker()` registers a handler on the single, real, hard-coded `"notify.send"` pg-boss queue; two independent Playwright worker processes each starting their own `startWorker()` would race nondeterministically for jobs on that shared queue.
- Never run this suite while `npm run worker:dev` is pointed at the same `DATABASE_URL` — an independent, permanent consumer of the same queue causes the identical race. State this in `global-setup.ts` and `fixtures.ts`.
- Every assertion filters by that flow's own tagged ids/addresses (never "the newest row" or an unscoped count) — `startWorker()`'s `requests.sweep`/`notifications.sweep` crons run against the whole shared dev database, not just this run's rows.
- `waitUntil` used anywhere in `tests/e2e/**` is the new async, throwing helper defined in `tests/e2e/fixtures.ts` — never the unrelated synchronous, silently-timing-out helper local to `src/jobs/queue.singleton-policy.live.test.ts` (spec §4.2, "C4").
- Fixtures are a plain module with exported async functions, never Playwright's `test.extend()` pattern (spec §4.1 — `test.extend`'s `use()` callback trips this repo's `react-hooks/rules-of-hooks` eslint rule).
- `.env.local` is exported in a subshell before running `npm run test:e2e`, and **never** before plain `npm test` (`ADAPTERS=real` breaks `src/config/env.test.ts`).
- `npm test` (vitest) must show the identical file/test count before and after every task in this plan — proves `tests/e2e/**` is truly excluded from it.
- Business numbers (percentages, points-per-credit) live only in seeded `app_config`, never as literals in test code (AGENTS.md §0.5) — this is the same rule as the rules-version constraint above, stated separately because it also covers `points.ts`'s formula, which tests must not silently re-derive as a hardcoded number either.
- **No classic RED→GREEN TDD applies to Tasks 2-5's flow assertions** — these tests integrate already-correct, already-merged production code; there is no new business logic being driven into existence. "RED" for those tasks means: run the flow once with an intentionally wrong assertion (e.g. an off-by-one on the expected refund) to prove the test can fail, then fix the assertion and get a real GREEN run against the live stack. Task 1's smoke spec is the one place classic RED→GREEN applies literally (it fails until the dependency exists).

## Review Focus

- **A flow's assertion runs before the real worker has actually delivered the notification**, racing `deliverNotification`'s own async pipeline — `waitUntil` must genuinely poll with a real predicate and throw (not silently return) on timeout. Task 1 tests this directly; every flow task uses it and would flake or hang instead of failing clearly if it were broken.
- **A hardcoded refund percentage or points-per-credit literal silently drifts from whatever `rules` version is actually seeded** the day someone runs this suite. Every flow task's own code must read the percentage/formula from `request.rulesVersion`'s rules, never assert e.g. `refundedCredits === 3`.
- **Two flows' real workers overlap and race on the shared `notify.send` queue** under Playwright's default parallel-worker-process behavior — pinned by `workers: 1`/`fullyParallel: false` in Task 1, and by each flow task calling `teardown()` before the file's tests end (verified via `afterAll`).
- **`admin.reviewProof`'s `adminUserId` foreign key, or `submitProof`'s content requirement, is silently skipped or supplied with a placeholder that doesn't reference a real row** — Task 2's `seedAdminUser` and Task 5's explicit `proofType: "text"` + non-empty `textContent` pin this.
- **The dev database's `companies` table has more than one seeded company with different tiers**, and a flow's assertion assumes a specific credit cost instead of reading `request.creditCost` — every flow task computes expected amounts from the actual returned `request`, never a tier-specific literal.

---

## Task Tiers (set `model` explicitly on every dispatch)

| Task | Implementer | Reviewer |
|---|---|---|
| 1 Playwright scaffolding + ESM-interop smoke test | sonnet | sonnet |
| 2 Shared fixtures | sonnet | opus (foundational; every flow's money/state/messaging assertions depend on it being correct) |
| 3 Flow B (decline → refund) | sonnet | opus (money) |
| 4 Flow C (expire → refund) | sonnet | opus (money) |
| 5 Flow A (accept → proof → verify, tranche-1) | sonnet | opus (money, state transition, message sending) |
| Final whole-branch review | — | opus |

---

## Task 1: Playwright scaffolding, config, and the ESM-interop smoke test

**Files:**
- Modify: `package.json`
- Create: `playwright.config.ts`
- Create: `tests/e2e/global-setup.ts`
- Create: `tests/e2e/smoke.spec.ts`
- Modify: `vitest.config.ts`
- Modify: `eslint.config.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `createRealQueueClient` from `../../src/jobs/queue.real` (Task 1 only imports it to prove the ESM-interop path — no other logic).
- Produces: `npm run test:e2e` (runs `playwright test`); `tests/e2e/global-setup.ts`'s default export, a Playwright `globalSetup` function — consumed by `playwright.config.ts`'s `globalSetup` field, not imported directly by any later task.

- [ ] **Step 1: Install `@playwright/test`**

Run: `npm install --save-dev @playwright/test`

This repo's other devDependencies use caret ranges in `package.json` with the exact resolved version pinned by the committed `package-lock.json` (confirmed: every existing entry, e.g. `"vitest": "^5.0.1"`, follows this convention) — follow the same convention here rather than a bare exact-version string, so `npm install --save-dev @playwright/test` (which npm resolves to the latest compatible release and writes as a caret range) is correct as-is. Do not manually edit the version npm writes.

Confirm no `projects`/browser download is needed: this task's config has no `projects` array, so `npx playwright install` must NOT be run and must NOT be added to any script.

- [ ] **Step 2: Write the failing smoke test**

Create `tests/e2e/smoke.spec.ts`:
```ts
// pg-boss is an ESM-only package; this repo is CommonJS. Every other test file that
// imports it runs under Vitest. This is the first thing in the repo to import repo
// code through Playwright's own TypeScript/CJS test compiler — if that interop is
// broken, this is where it fails, loudly and by itself, before any fixture or flow
// depends on it.
import { test, expect } from "@playwright/test";
import { createRealQueueClient } from "../../src/jobs/queue.real";

test("createRealQueueClient (which imports pg-boss) loads under Playwright's test runner", () => {
  expect(typeof createRealQueueClient).toBe("function");
});
```

- [ ] **Step 3: Run it to confirm it fails for the right reason**

Run: `npx playwright test tests/e2e/smoke.spec.ts`
Expected: FAIL — `@playwright/test` has no config yet (no `playwright.config.ts`), so this errors with something like "No config file found" or a resolution error, not a passing run. This step exists to confirm you have not accidentally already made it pass by running an old cached result.

- [ ] **Step 4: Write `playwright.config.ts`**

Create `playwright.config.ts` at the repo root:
```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  // Load-bearing, not stylistic: startWorker() registers a handler on the single,
  // real, hard-coded "notify.send" pg-boss queue. Two Playwright worker PROCESSES
  // each starting their own in-process startWorker() would become two independent
  // consumers racing for jobs on that one shared queue, and a flow's assertion
  // against its own fake email adapter could see zero sends even though the other
  // process's worker actually delivered it. Running everything sequentially in one
  // process, with each flow's teardown() fully stopping its queue client before the
  // next flow's setup starts, is the only way two startWorker() registrations for
  // "notify.send" are guaranteed never to be live at the same time in this run.
  workers: 1,
  fullyParallel: false,
  reporter: "list",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 30_000,
});
```

- [ ] **Step 5: Write `tests/e2e/global-setup.ts`**

Create `tests/e2e/global-setup.ts`:
```ts
import { Pool } from "pg";

const DOCKER_CLI_HINT =
  "Docker Desktop is not on PATH: C:\\Users\\dml-anmol\\AppData\\Local\\Programs\\DockerDesktop\\resources\\bin";

function setupFailure(reason: string): Error {
  return new Error(
    `[e2e] ${reason}\n\n` +
      "Fix, in order:\n" +
      `  1. Start Docker Desktop if it isn't running (${DOCKER_CLI_HINT})\n` +
      "  2. docker compose -f infra/compose.dev.yml up -d postgres\n" +
      "  3. npm run db:migrate\n" +
      "  4. npm run db:seed\n\n" +
      "Then run the suite with .env.local exported in a subshell (never before plain `npm test`):\n" +
      "  export $(grep -v '^#' .env.local | grep -v '^$' | xargs -d '\\n'); npm run test:e2e"
  );
}

export default async function globalSetup(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw setupFailure("DATABASE_URL is not set.");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query("select 1");

    const companies = await pool.query<{ count: string }>("select count(*) as count from companies");
    if (Number(companies.rows[0].count) === 0) {
      throw setupFailure("No seeded companies found.");
    }

    const rules = await pool.query<{ value: { pointsPerCredit?: number } }>(
      "select value from app_config where key = 'rules' order by version desc limit 1"
    );
    if (rules.rows.length === 0 || rules.rows[0].value.pointsPerCredit === undefined) {
      throw setupFailure(
        "The latest seeded `rules` version has no `pointsPerCredit` — the rewards config placeholders " +
          "(rules version 2 or later) haven't been seeded."
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("[e2e]")) throw err;
    throw setupFailure(`Could not reach Postgres: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await pool.end();
  }
}
```

- [ ] **Step 6: Add the npm script**

In `package.json`, add to `"scripts"` (after `"test:watch"`):
```json
    "test:e2e": "playwright test",
```

- [ ] **Step 7: Exclude `tests/e2e` from vitest**

In `vitest.config.ts`, add `"**/tests/e2e/**"` to the `test.exclude` array, alongside the existing `"**/.worktrees/**"` entry.

- [ ] **Step 8: Ignore Playwright's output directories**

In `eslint.config.mjs`, add `"test-results/**"` and `"playwright-report/**"` to the existing `globalIgnores([...])` array, alongside `.worktrees/**`.

In `.gitignore`, add two lines:
```
test-results/
playwright-report/
```

- [ ] **Step 9: Run the smoke test with the stack down, confirm the fast, clear failure**

Ensure the dev Postgres container is NOT running (or `DATABASE_URL` unset in this shell), then run: `npx playwright test tests/e2e/smoke.spec.ts`
Expected: FAILS in well under 5 seconds, printing the `globalSetup` error message with the exact fix steps — not a generic connection-refused stack trace or a hang.

- [ ] **Step 10: Bring the stack up and run the smoke test for real**

```bash
docker compose -f infra/compose.dev.yml up -d postgres
export $(grep -v '^#' .env.local | grep -v '^$' | xargs -d '\n')
npm run db:migrate
npm run db:seed
npm run test:e2e
```
Expected: PASS — 1 test passed. This is the proof that `pg-boss`'s ESM interop works under Playwright's compiler before any fixture code is written.

- [ ] **Step 11: Confirm `npm test` (vitest) is unaffected**

In a clean shell (`.env.local` NOT exported): run `npm test` and compare the file/test count against the count before this task (49 files / 501 tests passed, 3 skipped, per `SESSION-HANDOFF.md` §0 at the time this plan was written — the count must be unchanged; if it grew, `tests/e2e/**` is not actually excluded).

- [ ] **Step 12: Lint and typecheck**

Run: `npm run lint && npm run typecheck`
Expected: both clean.

- [ ] **Step 13: Commit**

```bash
git add package.json package-lock.json playwright.config.ts tests/e2e/global-setup.ts tests/e2e/smoke.spec.ts vitest.config.ts eslint.config.mjs .gitignore
git commit -m "feat(e2e): add Playwright scaffolding and prove the pg-boss ESM interop"
```

---

## Task 2: Shared E2E fixtures

**Files:**
- Create: `tests/e2e/fixtures.ts`
- Test: `tests/e2e/fixtures.spec.ts`

**Interfaces:**
- Consumes: `createRealDatabase` (`src/adapters/db/real.ts`), `createRealQueueClient` (`src/jobs/queue.real.ts`), `startWorker`, `type WorkerDeps` (`src/jobs/worker.ts`), `createFakeEmailSender` (`src/adapters/email/fake.ts`), `createFakeWhatsAppGateway` (`src/adapters/whatsapp/fake.ts`), `type Database`, `type Rules` types as needed from `src/adapters/db/types.ts` and `src/modules/config/schemas.ts`.
- Produces (all from `tests/e2e/fixtures.ts`, consumed by Tasks 3-5):
  - `createE2eContext(): Promise<E2eContext>` where
    ```ts
    export interface E2eContext {
      db: Database;
      pool: Pool; // from "pg"
      queue: QueueClient; // from "../../src/jobs/queue"
      emailSent: EmailMessage[]; // from "../../src/adapters/email/types"
      whatsapp: WhatsAppGateway; // from "../../src/adapters/whatsapp/types"
      companyId: string;
      teardown(): Promise<void>;
    }
    ```
  - `seedFundedSeeker(ctx: E2eContext, tag: string, counter: number): Promise<{ profileId: string; userId: string; email: string }>`
  - `seedVerifiedInsider(ctx: E2eContext, tag: string, counter: number): Promise<{ profileId: string; userId: string; email: string }>`
  - `seedAdminUser(ctx: E2eContext, tag: string): Promise<string>` (returns the user id)
  - `findNotification(pool: Pool, idempotencyKey: string): Promise<{ id: string; status: string; channel: string | null } | null>`
  - `notificationKey(eventKey: string, template: string, userId: string): string` — returns `` `${eventKey}:${template}:${userId}` `` (the exact composition `notify()` uses internally, confirmed in `src/modules/notifications/notifications.ts`)
  - `waitUntil(check: () => Promise<boolean>, timeoutMs: number, label: string): Promise<void>` — throws `Error(\`Timed out after ${timeoutMs}ms waiting for: ${label}\`)` if the predicate never returns true within the budget

- [ ] **Step 1: Write the failing tests for the pure helpers**

Create `tests/e2e/fixtures.spec.ts` (this file tests `fixtures.ts` itself — it needs no live Postgres, since `notificationKey` and `waitUntil` are pure/self-contained):
```ts
import { test, expect } from "@playwright/test";
import { notificationKey, waitUntil } from "./fixtures";

test("notificationKey composes eventKey:template:userId, matching notify()'s own key format", () => {
  expect(notificationKey("request:r1:decline", "request.declined", "u1")).toBe(
    "request:r1:decline:request.declined:u1"
  );
});

test("waitUntil resolves as soon as the predicate returns true", async () => {
  let calls = 0;
  await waitUntil(
    async () => {
      calls++;
      return calls >= 3;
    },
    5_000,
    "test predicate"
  );
  expect(calls).toBe(3);
});

test("waitUntil throws a descriptive error if the predicate never becomes true within the budget", async () => {
  await expect(
    waitUntil(async () => false, 300, "something that never happens")
  ).rejects.toThrow(/Timed out after 300ms waiting for: something that never happens/);
});
```

- [ ] **Step 2: Run to confirm RED**

Run: `npx playwright test tests/e2e/fixtures.spec.ts`
Expected: FAIL — `./fixtures` does not exist yet.

- [ ] **Step 3: Write `tests/e2e/fixtures.ts`**

```ts
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { createRealDatabase } from "../../src/adapters/db/real";
import { createRealQueueClient } from "../../src/jobs/queue.real";
import { startWorker, type WorkerDeps } from "../../src/jobs/worker";
import { createFakeEmailSender } from "../../src/adapters/email/fake";
import { createFakeWhatsAppGateway } from "../../src/adapters/whatsapp/fake";
import type { Database } from "../../src/adapters/db/types";
import type { QueueClient } from "../../src/jobs/queue";
import type { EmailMessage } from "../../src/adapters/email/types";
import type { WhatsAppGateway } from "../../src/adapters/whatsapp/types";

// NOTE: never run this suite while `npm run worker:dev` is pointed at the same
// DATABASE_URL — it is an independent, permanent consumer of the real "notify.send"
// queue and would race with this run's in-process worker exactly like two Playwright
// worker processes would (see playwright.config.ts's workers: 1 comment).

export interface E2eContext {
  db: Database;
  pool: Pool;
  queue: QueueClient;
  emailSent: EmailMessage[];
  whatsapp: WhatsAppGateway;
  companyId: string;
  teardown(): Promise<void>;
}

export async function createE2eContext(): Promise<E2eContext> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = createRealDatabase(drizzle(pool));
  const queue = createRealQueueClient(process.env.DATABASE_URL as string);
  const { sender, sent } = createFakeEmailSender();
  const whatsapp = createFakeWhatsAppGateway();

  // startWorker() calls deps.queue.start() itself — do not call queue.start() here too.
  const workerDeps: WorkerDeps = { db, queue, email: sender, whatsapp: whatsapp.gateway };
  await startWorker(workerDeps);

  const { rows } = await pool.query<{ id: string }>("select id from companies limit 1");
  if (rows.length === 0) throw new Error("No seeded companies found — run `npm run db:seed` first");
  const companyId = rows[0].id;

  return {
    db,
    pool,
    queue,
    emailSent: sent,
    whatsapp: whatsapp.gateway,
    companyId,
    async teardown() {
      await queue.stop();
      await pool.end();
    },
  };
}

export async function seedFundedSeeker(
  ctx: E2eContext,
  tag: string,
  counter: number
): Promise<{ profileId: string; userId: string; email: string }> {
  const email = `s-${tag}-${counter}@x.com`;
  const user = await ctx.db.identity.findOrCreateUser(`fb-e2e-${tag}-s${counter}`, email, "seeker");
  const profile = await ctx.db.identity.createSeekerProfile(user.id, `E2E Seeker ${counter}`);

  // Fund enough to cover the most expensive tier, read from config, never a literal.
  const rules = await ctx.pool.query<{ value: { requestCostByTier: Record<string, number> } }>(
    "select value from app_config where key = 'rules' order by version desc limit 1"
  );
  const maxCost = Math.max(...Object.values(rules.rows[0].value.requestCostByTier));

  await ctx.db.ledger.postTxn({
    idempotencyKey: `e2e:${tag}:grant:${counter}`,
    eventType: "credits.grant",
    entries: [
      { ownerType: "platform", ownerId: "platform", currency: "credits", amount: -maxCost },
      { ownerType: "seeker", ownerId: profile.id, currency: "credits", amount: maxCost },
    ],
  });

  return { profileId: profile.id, userId: user.id, email };
}

export async function seedVerifiedInsider(
  ctx: E2eContext,
  tag: string,
  counter: number
): Promise<{ profileId: string; userId: string; email: string }> {
  const email = `i-${tag}-${counter}@acme.com`;
  const user = await ctx.db.identity.findOrCreateUser(`fb-e2e-${tag}-i${counter}`, email, "seeker");
  const profile = await ctx.db.identity.findOrCreateInsiderProfile(user.id, ctx.companyId, email);
  await ctx.db.identity.markInsiderVerified(profile.id, new Date());
  return { profileId: profile.id, userId: user.id, email };
}

export async function seedAdminUser(ctx: E2eContext, tag: string): Promise<string> {
  const user = await ctx.db.identity.findOrCreateUser(`fb-e2e-${tag}-admin`, `admin-${tag}@x.com`, "admin");
  return user.id;
}

export function notificationKey(eventKey: string, template: string, userId: string): string {
  return `${eventKey}:${template}:${userId}`;
}

export async function findNotification(
  pool: Pool,
  idempotencyKey: string
): Promise<{ id: string; status: string; channel: string | null } | null> {
  const { rows } = await pool.query<{ id: string; status: string; channel: string | null }>(
    "select id, status, channel from notifications where idempotency_key = $1",
    [idempotencyKey]
  );
  return rows[0] ?? null;
}

export async function waitUntil(
  check: () => Promise<boolean>,
  timeoutMs: number,
  label: string
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for: ${label}`);
}
```

- [ ] **Step 4: Run to confirm GREEN**

Run: `npx playwright test tests/e2e/fixtures.spec.ts`
Expected: PASS — 3 tests passed. (No live Postgres needed for this file; `createE2eContext`/`seedFundedSeeker`/etc. are exercised for real by Tasks 3-5, not here.)

- [ ] **Step 5: Verify and commit**

Run: `npm run lint && npm run typecheck`, then confirm `npm test` (vitest, no env exported) is still unchanged from Task 1's count.
```bash
git add tests/e2e/fixtures.ts tests/e2e/fixtures.spec.ts
git commit -m "feat(e2e): add shared fixtures for driving flows against the real stack"
```

---

## Task 3: Flow B — send → decline → refund

**Files:**
- Create: `tests/e2e/flow-b-decline-refund.spec.ts`

**Interfaces:**
- Consumes: everything Task 2 produces; `sendRequest`, `decline`, `type RequestsDeps` from `../../src/modules/requests/requests`; `getRulesWithVersion` from `../../src/modules/config/config`.

- [ ] **Step 1: Write the flow test**

Create `tests/e2e/flow-b-decline-refund.spec.ts`:
```ts
import { test, expect } from "@playwright/test";
import {
  createE2eContext,
  seedFundedSeeker,
  seedVerifiedInsider,
  findNotification,
  notificationKey,
  waitUntil,
  type E2eContext,
} from "./fixtures";
import { sendRequest, decline, type RequestsDeps } from "../../src/modules/requests/requests";
import { getRulesWithVersion } from "../../src/modules/config/config";

const tag = Date.now().toString(36);

test.describe("Flow B: send -> decline -> refund", () => {
  let ctx: E2eContext;

  test.beforeAll(async () => {
    ctx = await createE2eContext();
  });

  test.afterAll(async () => {
    await ctx.teardown();
  });

  test("a declined request refunds the seeker per the request's own stamped rules version", async () => {
    const seeker = await seedFundedSeeker(ctx, tag, 1);
    const insider = await seedVerifiedInsider(ctx, tag, 1);
    const deps: RequestsDeps = { db: ctx.db, queue: ctx.queue };

    const balanceBefore = await ctx.db.ledger.getBalance("seeker", seeker.profileId, "credits");

    const request = await sendRequest(deps, {
      idempotencyKey: `e2e:${tag}:flowB:send`,
      seekerProfileId: seeker.profileId,
      insiderProfileId: insider.profileId,
    });

    const declined = await decline(deps, request.id);
    expect(declined.state).toBe("DECLINED");

    // Never a literal percentage: read the rules this specific request was stamped
    // with, the same rules version decline() itself used.
    const { rules } = await getRulesWithVersion(deps, request.rulesVersion);
    const expectedRefund = Math.round((request.creditCost * rules.refundPercentOnDecline) / 100);

    const balanceAfter = await ctx.db.ledger.getBalance("seeker", seeker.profileId, "credits");
    expect(balanceAfter).toBe(balanceBefore - request.creditCost + expectedRefund);

    // request.expire's own 48h timer job is still scheduled at this point — that is
    // expected, not a leak. It will fire later and no-op, because expire()'s own
    // guard checks state !== "SENT" before doing anything.

    const key = notificationKey(`request:${request.id}:decline`, "request.declined", seeker.userId);
    await waitUntil(
      async () => (await findNotification(ctx.pool, key))?.status === "sent",
      10_000,
      `notification ${key} to reach status "sent"`
    );

    const emailsToSeeker = ctx.emailSent.filter((m) => m.to === seeker.email);
    expect(emailsToSeeker).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it with the stack up, confirm it can fail (RED for the assertion, not the harness)**

Temporarily change `expectedRefund` to `expectedRefund + 1` and run:
```bash
export $(grep -v '^#' .env.local | grep -v '^$' | xargs -d '\n')
npx playwright test tests/e2e/flow-b-decline-refund.spec.ts
```
Expected: FAIL on the balance assertion. This proves the test can actually detect a wrong refund, not just pass regardless.

- [ ] **Step 3: Revert the off-by-one and run for real GREEN**

Revert `expectedRefund + 1` back to `expectedRefund`. Run: `npx playwright test tests/e2e/flow-b-decline-refund.spec.ts`
Expected: PASS.

- [ ] **Step 4: Verify and commit**

`npm run lint && npm run typecheck`; confirm `npm test` (vitest, clean shell) is unchanged.
```bash
git add tests/e2e/flow-b-decline-refund.spec.ts
git commit -m "test(e2e): add Flow B (send -> decline -> refund)"
```

---

## Task 4: Flow C — send → expire → refund

**Files:**
- Create: `tests/e2e/flow-c-expiry-refund.spec.ts`

**Interfaces:**
- Consumes: everything Task 2 produces; `sendRequest`, `expire`, `type RequestsDeps` from `../../src/modules/requests/requests`; `getRulesWithVersion` from `../../src/modules/config/config`.

- [ ] **Step 1: Write the flow test**

Create `tests/e2e/flow-c-expiry-refund.spec.ts`:
```ts
import { test, expect } from "@playwright/test";
import {
  createE2eContext,
  seedFundedSeeker,
  seedVerifiedInsider,
  findNotification,
  notificationKey,
  waitUntil,
  type E2eContext,
} from "./fixtures";
import { sendRequest, expire, type RequestsDeps } from "../../src/modules/requests/requests";
import { getRulesWithVersion } from "../../src/modules/config/config";

const tag = Date.now().toString(36);

test.describe("Flow C: send -> expire -> refund", () => {
  let ctx: E2eContext;

  test.beforeAll(async () => {
    ctx = await createE2eContext();
  });

  test.afterAll(async () => {
    await ctx.teardown();
  });

  test("calling expire() directly (what the real 48h timer job calls) refunds the seeker", async () => {
    const seeker = await seedFundedSeeker(ctx, tag, 1);
    const insider = await seedVerifiedInsider(ctx, tag, 1);
    const deps: RequestsDeps = { db: ctx.db, queue: ctx.queue };

    const balanceBefore = await ctx.db.ledger.getBalance("seeker", seeker.profileId, "credits");

    const request = await sendRequest(deps, {
      idempotencyKey: `e2e:${tag}:flowC:send`,
      seekerProfileId: seeker.profileId,
      insiderProfileId: insider.profileId,
    });

    // expire() IS the unit of work the real request.expire pg-boss job calls when its
    // 48h timer fires. Calling it directly proves the outcome without waiting 48 real
    // hours — there is nothing left to prove by actually waiting.
    const expired = await expire(deps, request.id);
    expect(expired.state).toBe("EXPIRED");

    const { rules } = await getRulesWithVersion(deps, request.rulesVersion);
    const expectedRefund = Math.round((request.creditCost * rules.refundPercentOnExpiry) / 100);

    const balanceAfter = await ctx.db.ledger.getBalance("seeker", seeker.profileId, "credits");
    expect(balanceAfter).toBe(balanceBefore - request.creditCost + expectedRefund);

    const key = notificationKey(`request:${request.id}:expire`, "request.expired", seeker.userId);
    await waitUntil(
      async () => (await findNotification(ctx.pool, key))?.status === "sent",
      10_000,
      `notification ${key} to reach status "sent"`
    );

    const emailsToSeeker = ctx.emailSent.filter((m) => m.to === seeker.email);
    expect(emailsToSeeker).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it with the stack up, confirm it can fail**

Temporarily change `expectedRefund` to `expectedRefund + 1` and run: `npx playwright test tests/e2e/flow-c-expiry-refund.spec.ts`
Expected: FAIL on the balance assertion.

- [ ] **Step 3: Revert and run for real GREEN**

Revert the change. Run: `npx playwright test tests/e2e/flow-c-expiry-refund.spec.ts`
Expected: PASS.

- [ ] **Step 4: Verify and commit**

`npm run lint && npm run typecheck`; confirm `npm test` (vitest, clean shell) is unchanged.
```bash
git add tests/e2e/flow-c-expiry-refund.spec.ts
git commit -m "test(e2e): add Flow C (send -> expire -> refund)"
```

---

## Task 5: Flow A — send → accept → proof → verify (tranche 1), interview leg stubbed

**Files:**
- Create: `tests/e2e/flow-a-interview.spec.ts`

**Interfaces:**
- Consumes: everything Task 2 produces; `sendRequest`, `accept`, `submitProof`, `type RequestsDeps` from `../../src/modules/requests/requests`; `reviewProof`, `type AdminDeps` from `../../src/modules/admin/admin`; `getRulesWithVersion` from `../../src/modules/config/config`; `computeTranchePoints` from `../../src/modules/rewards/points`.

- [ ] **Step 1: Write the flow test**

Create `tests/e2e/flow-a-interview.spec.ts`:
```ts
import { test, expect } from "@playwright/test";
import {
  createE2eContext,
  seedFundedSeeker,
  seedVerifiedInsider,
  seedAdminUser,
  findNotification,
  notificationKey,
  waitUntil,
  type E2eContext,
} from "./fixtures";
import { sendRequest, accept, submitProof, type RequestsDeps } from "../../src/modules/requests/requests";
import { reviewProof, type AdminDeps } from "../../src/modules/admin/admin";
import { getRulesWithVersion } from "../../src/modules/config/config";
import { computeTranchePoints } from "../../src/modules/rewards/points";

const tag = Date.now().toString(36);

test.describe("Flow A: send -> accept -> proof -> verify", () => {
  let ctx: E2eContext;

  test.beforeAll(async () => {
    ctx = await createE2eContext();
  });

  test.afterAll(async () => {
    await ctx.teardown();
  });

  test("verifying proof releases tranche-1 points and notifies everyone involved", async () => {
    const seeker = await seedFundedSeeker(ctx, tag, 1);
    const insider = await seedVerifiedInsider(ctx, tag, 1);
    const adminUserId = await seedAdminUser(ctx, tag);
    const requestsDeps: RequestsDeps = { db: ctx.db, queue: ctx.queue };
    const adminDeps: AdminDeps = { db: ctx.db, queue: ctx.queue };

    const request = await sendRequest(requestsDeps, {
      idempotencyKey: `e2e:${tag}:flowA:send`,
      seekerProfileId: seeker.profileId,
      insiderProfileId: insider.profileId,
    });

    const acceptedKey = notificationKey(`request:${request.id}:accept`, "request.accepted", seeker.userId);
    const accepted = await accept(requestsDeps, request.id);
    expect(accepted.state).toBe("ACCEPTED");
    await waitUntil(
      async () => (await findNotification(ctx.pool, acceptedKey))?.status === "sent",
      10_000,
      `notification ${acceptedKey} to reach status "sent"`
    );

    const submitted = await submitProof(requestsDeps, {
      idempotencyKey: `e2e:${tag}:flowA:proof`,
      requestId: request.id,
      proofType: "text",
      textContent: "Submitted the candidate internally via the referral portal on 2026-09-29.",
    });
    expect(submitted.state).toBe("PROOF_PENDING");

    const reviewIdempotencyKey = `e2e:${tag}:flowA:review`;
    const transitionKey = `review:${request.id}:${reviewIdempotencyKey}`;

    const verified = await reviewProof(adminDeps, {
      idempotencyKey: reviewIdempotencyKey,
      adminUserId,
      requestId: request.id,
      decision: "verify",
    });
    expect(verified.state).toBe("SUBMITTED");

    // proof.verified goes to both the Insider and the Seeker under the same event key.
    const verifiedInsiderKey = notificationKey(transitionKey, "proof.verified", insider.userId);
    const verifiedSeekerKey = notificationKey(transitionKey, "proof.verified", seeker.userId);
    await waitUntil(
      async () => (await findNotification(ctx.pool, verifiedInsiderKey))?.status === "sent",
      10_000,
      `notification ${verifiedInsiderKey} to reach status "sent"`
    );
    await waitUntil(
      async () => (await findNotification(ctx.pool, verifiedSeekerKey))?.status === "sent",
      10_000,
      `notification ${verifiedSeekerKey} to reach status "sent"`
    );

    // Tranche-1 points: read config from the request's own stamped rules version (this
    // run's global-setup already confirmed the latest seeded rules has pointsPerCredit,
    // so this is reachable by construction). Assert independently of just re-deriving
    // computeTranchePoints again, so a bug in that function can't pass silently.
    const { rules } = await getRulesWithVersion(requestsDeps, request.rulesVersion);
    const expectedPoints = computeTranchePoints(rules, request.creditCost, 1);

    const wallet = await ctx.db.rewards.getWallet(insider.profileId);
    expect(wallet.balance).toBeGreaterThan(0);
    expect(wallet.balance).toBe(expectedPoints);
    expect(wallet.lifetimeEarned).toBe(wallet.balance);

    const rewards = await ctx.db.rewards.listRewards(insider.profileId);
    const tranche1Rewards = rewards.filter((r) => r.tranche === 1 && r.requestId === request.id);
    expect(tranche1Rewards).toHaveLength(1);
    expect(tranche1Rewards[0].points).toBe(expectedPoints);

    const rewardReleasedKey = notificationKey(transitionKey, "reward.released", insider.userId);
    await waitUntil(
      async () => (await findNotification(ctx.pool, rewardReleasedKey))?.status === "sent",
      10_000,
      `notification ${rewardReleasedKey} to reach status "sent"`
    );
  });

  test.fixme(
    "interview confirmation and tranche 2 (blocked: no confirmInterview()/reportInterview() function exists — " +
      "state.ts defines the interview/complete/windowExpiry/close transitions but nothing drives them; " +
      "see USER-FLOWS.md §9 and SESSION-HANDOFF.md §5 item 2, 'Interview confirmation and disputes')",
    async () => {
      /* intentionally empty — this test exists to be found, not to run. Playwright
         reports it as skipped (with this title, via reporter: "list" in
         playwright.config.ts), not as a pass; see the spec's §4.5 for why
         test.fixme() rather than test.skip() or test.fail() is the right choice here. */
    }
  );
});
```

- [ ] **Step 2: Run it with the stack up, confirm the real assertion can fail**

Temporarily change `expectedPoints` to `expectedPoints + 1` (or change the `toHaveLength(1)` check on `tranche1Rewards` to `toHaveLength(2)`) and run:
```bash
npx playwright test tests/e2e/flow-a-interview.spec.ts
```
Expected: FAIL on the points assertion.

- [ ] **Step 3: Revert and run for real GREEN**

Revert the change. Run: `npx playwright test tests/e2e/flow-a-interview.spec.ts`
Expected: 1 passed, 1 skipped (the `fixme` test). Confirm the `list` reporter's output shows the `fixme` test's full title (the gap explanation), not just a bare "skipped" count.

- [ ] **Step 4: Run the whole suite together**

```bash
npm run test:e2e
```
Expected: all of Tasks 1-5's specs run sequentially (workers: 1) and pass (with the one `fixme` skip in Flow A), with no cross-flow interference.

- [ ] **Step 5: Verify and commit**

`npm run lint && npm run typecheck`; confirm `npm test` (vitest, clean shell) is unchanged from Task 1's baseline count.
```bash
git add tests/e2e/flow-a-interview.spec.ts
git commit -m "test(e2e): add Flow A (send -> accept -> proof -> verify), interview leg fixme"
```

---

## Post-tasks (controller)

- Final whole-branch review (opus) against the spec and AGENTS.md; fix Critical/Important in one wave.
- Update `SESSION-HANDOFF.md`: record this merge, that Phase 1 backend's Playwright item is now done (with the named exception of the interview leg), the exact `npm run test:e2e` invocation, and the `fixme` gap as a pointer for whoever eventually builds interview confirmation.
- `finishing-a-development-branch`: merge with a merge commit into `main`, re-run `npm run lint && npm run typecheck && npm test` on `main`, then the full `npm run test:e2e` invocation (stack up, env exported) on `main`, do not push, remove the worktree, delete the branch.
