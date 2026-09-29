// @vitest-environment node
// Live test against a real Postgres (dev compose) and real pg-boss. Skipped unless
// RUN_VENDOR_TESTS=1 — this is concurrency, fakes cannot prove it.
// Run: export $(grep -v '^#' .env.local | grep -v '^$' | xargs -d '\n');
//      RUN_VENDOR_TESTS=1 npx vitest run src/jobs/queue.singleton-policy.live.test.ts
//
// Do not run this alongside a live `npm run worker:dev` (or any other process) against the
// same DATABASE_URL: a concurrently running worker also polls the real `notify.send` queue
// this file uses in its third describe block, and could fetch/complete one of this test's
// jobs itself, making the assertions here flaky or simply wrong.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { createRealQueueClient } from "./queue.real";
import { createRealDatabase } from "../adapters/db/real";
import { createFakeEmailSender } from "../adapters/email/fake";
import { createFakeWhatsAppGateway } from "../adapters/whatsapp/fake";
import { notify, deliverNotification, type DeliveryDeps } from "../modules/notifications/notifications";
import type { QueueClient } from "./queue";

const live = process.env.RUN_VENDOR_TESTS === "1";

// pg-boss's default idle poll interval is 2000ms (attorney.js's applyPollingInterval, when
// pollingIntervalSeconds is unset). Forcing it down to the protocol minimum (500ms, see
// MIN_POLLING_INTERVAL_MS in attorney.js) for these test clients means a client's next fetch
// attempt is never more than ~0.5s away, and the handler sleep below (1500ms) is comfortably
// longer than that — so a second, polling client is essentially guaranteed to attempt (and,
// under "standard" policy, succeed at) a fetch while the first job is still active. Without
// this, a handler sleep shorter than the *default* 2000ms poll gap could let both jobs finish
// without ever colliding, and every assertion below would pass without proving anything.
const FAST_POLL = { pollingIntervalSeconds: 0.5 };
const HANDLER_SLEEP_MS = 1500;

/** Polls `check` every `intervalMs` until it returns true or `timeoutMs` elapses. */
async function waitUntil(check: () => boolean, timeoutMs: number, intervalMs = 100): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

describe.skipIf(!live)("notify.send queue singleton policy (real Postgres + real pg-boss)", () => {
  const tag = Date.now().toString(36);

  describe("singleton policy serializes same-key jobs across two independent clients", () => {
    const queueName = `test-singleton-${tag}`;
    let client1: QueueClient;
    let client2: QueueClient;
    let active = 0;
    let maxActive = 0;
    let completed = 0;

    beforeAll(async () => {
      client1 = createRealQueueClient(process.env.DATABASE_URL as string);
      client2 = createRealQueueClient(process.env.DATABASE_URL as string);
      await client1.start();
      await client2.start();

      const handler = async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        try {
          await new Promise((r) => setTimeout(r, HANDLER_SLEEP_MS));
        } finally {
          active--;
          completed++;
        }
      };
      await client1.work(queueName, handler, { policy: "singleton", ...FAST_POLL });
      await client2.work(queueName, handler, { policy: "singleton", ...FAST_POLL });
    });

    afterAll(async () => {
      await client1.stop();
      await client2.stop();
    });

    it(
      "never runs two jobs with the same singletonKey at once, and both still complete",
      async () => {
        const singletonKey = `singleton-test:${tag}`;
        await client1.send(queueName, {}, { singletonKey, policy: "singleton" });
        await client2.send(queueName, {}, { singletonKey, policy: "singleton" });

        await waitUntil(() => completed >= 2, 10_000);

        expect(completed).toBe(2);
        expect(maxActive).toBe(1);
      },
      // Vitest's default per-test timeout is 5000ms. Two 1500ms handler sleeps run serialized
      // under the singleton policy here (job2 only starts once job1 finishes), plus polling
      // delay and DB round-trips, so the default margin isn't enough — pass an explicit budget.
      20_000
    );
  });

  // Companion regression-test-for-the-test: proves the methodology above actually detects
  // overlap when it's allowed to happen, so a future change to this file can't silently make
  // the singleton assertion vacuous. With fast polling and a handler sleep well longer than the
  // poll interval, this is no longer a matter of luck: both clients WILL attempt a fetch while
  // the first job is still active, and under "standard" policy that fetch WILL succeed. This
  // must be a strict `=== 2`, the same way the singleton case above is a strict `=== 1` — a
  // control that can't fail isn't a control.
  describe("standard policy allows same-key jobs to overlap (sanity check on the test methodology)", () => {
    const queueName = `test-standard-${tag}`;
    let client1: QueueClient;
    let client2: QueueClient;
    let active = 0;
    let maxActive = 0;
    let completed = 0;

    beforeAll(async () => {
      client1 = createRealQueueClient(process.env.DATABASE_URL as string);
      client2 = createRealQueueClient(process.env.DATABASE_URL as string);
      await client1.start();
      await client2.start();

      const handler = async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        try {
          await new Promise((r) => setTimeout(r, HANDLER_SLEEP_MS));
        } finally {
          active--;
          completed++;
        }
      };
      await client1.work(queueName, handler, { policy: "standard", ...FAST_POLL });
      await client2.work(queueName, handler, { policy: "standard", ...FAST_POLL });
    });

    afterAll(async () => {
      await client1.stop();
      await client2.stop();
    });

    it(
      "observes both jobs active at once under standard policy",
      async () => {
        const singletonKey = `standard-test:${tag}`;
        await client1.send(queueName, {}, { singletonKey });
        await client2.send(queueName, {}, { singletonKey });

        await waitUntil(() => completed >= 2, 10_000);

        expect(completed).toBe(2);
        expect(maxActive).toBe(2);
      },
      // See the timeout comment on the singleton-policy test above — same margin needed here.
      20_000
    );
  });

  // The actual regression test for the real bug class this task closes: two independent worker
  // registrations processing the SAME notification id must deliver exactly once, with no
  // duplicate email/WhatsApp send, even when a second delivery attempt is forced to race the
  // first (as sweepPendingNotifications could if it fired while the original job was still
  // mid-flight on a slow vendor call).
  describe("notify.send double-delivery regression (real notify() + real deliverNotification, fake vendors)", () => {
    let pool: Pool;
    let dbClient1: ReturnType<typeof createRealDatabase>;
    let dbClient2: ReturnType<typeof createRealDatabase>;
    let queueClient1: QueueClient;
    let queueClient2: QueueClient;

    beforeAll(async () => {
      pool = new Pool({ connectionString: process.env.DATABASE_URL });
      const rawPool = new Pool({ connectionString: process.env.DATABASE_URL });

      // One-time dev-database fixup: this repo's `notify.send` queue was created long ago
      // (before this fix) under pg-boss's default "standard" policy. pg-boss's createQueue is
      // ON CONFLICT DO NOTHING, so simply calling createQueue with policy: "singleton" again
      // would silently be a no-op and this test would not actually exercise singleton
      // enforcement. Deleting only the queue's registration row (not the whole pgboss schema,
      // not other queues' job history) lets pg-boss recreate it fresh with the policy the next
      // createQueue call passes. A fresh/first-ever database needs no such step — and, if this
      // file is filtered to run standalone (`-t` to just this describe block) before the pgboss
      // schema has ever been created by any client `start()`, `pgboss.queue`/`pgboss.job_common`
      // may not exist yet at all, so every statement below is guarded with `to_regclass(...)`.
      //
      // pgboss.job_common has `q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name)
      // ON DELETE RESTRICT` — any prior notify.send job rows (this dev database has a handful
      // of old completed ones from earlier manual/dev testing) block deleting the queue row
      // until they're gone too. This only removes notify.send's own job history, never touches
      // other queues' rows.
      const jobCommonExists = await rawPool.query<{ reg: string | null }>(
        "select to_regclass('pgboss.job_common') as reg"
      );
      if (jobCommonExists.rows[0]?.reg) {
        await rawPool.query("DELETE FROM pgboss.job_common WHERE name = 'notify.send'");
      }
      const queueTableExists = await rawPool.query<{ reg: string | null }>("select to_regclass('pgboss.queue') as reg");
      if (queueTableExists.rows[0]?.reg) {
        await rawPool.query("DELETE FROM pgboss.queue WHERE name = 'notify.send'");
      }
      await rawPool.end();

      dbClient1 = createRealDatabase(drizzle(pool));
      dbClient2 = createRealDatabase(drizzle(pool));
      queueClient1 = createRealQueueClient(process.env.DATABASE_URL as string);
      queueClient2 = createRealQueueClient(process.env.DATABASE_URL as string);
      await queueClient1.start();
      await queueClient2.start();
    });

    afterAll(async () => {
      await queueClient1.stop();
      await queueClient2.stop();
      await pool.end();
    });

    it(
      "delivers a notification exactly once even when two independent worker registrations race on the same id",
      async () => {
        const user = await dbClient1.identity.findOrCreateUser(`fb-sp-${tag}`, `sp-${tag}@x.com`, "seeker");

        const { sender: email1, sent: sent1 } = createFakeEmailSender();
        const { gateway: whatsapp1 } = createFakeWhatsAppGateway();
        const { sender: email2, sent: sent2 } = createFakeEmailSender();
        const { gateway: whatsapp2 } = createFakeWhatsAppGateway();
        const deliveryDeps1: DeliveryDeps = { db: dbClient1, email: email1, whatsapp: whatsapp1 };
        const deliveryDeps2: DeliveryDeps = { db: dbClient2, email: email2, whatsapp: whatsapp2 };

        let inFlight = 0;
        let maxInFlight = 0;
        let handledCount = 0;
        const wrapHandler = (deps: DeliveryDeps) => async (payload: unknown) => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          try {
            const { notificationId } = payload as { notificationId: string };
            // Artificial delay simulates a slow vendor call, and — same reasoning as FAST_POLL/
            // HANDLER_SLEEP_MS above — is long enough relative to the 0.5s poll interval that
            // the second (duplicate) job is essentially guaranteed to have its own fetch
            // attempted while this one is still active, actually exercising the singleton
            // enforcement rather than just getting lucky on ordering.
            await new Promise((r) => setTimeout(r, HANDLER_SLEEP_MS));
            await deliverNotification(deps, notificationId);
            handledCount++;
          } finally {
            inFlight--;
          }
        };

        // Registers notify.send under "singleton" policy — this call is what actually
        // (re)creates the queue after the beforeAll fixup deleted its old "standard"
        // registration.
        await queueClient1.work("notify.send", wrapHandler(deliveryDeps1), { policy: "singleton", ...FAST_POLL });
        await queueClient2.work("notify.send", wrapHandler(deliveryDeps2), { policy: "singleton", ...FAST_POLL });

        await notify(
          { db: dbClient1, queue: queueClient1 },
          user.id,
          "request.accepted",
          { requestId: `r-${tag}`, companyName: "Acme" },
          `evt:singleton:${tag}`
        );

        // A second, independent enqueue attempt with the identical singletonKey
        // (as sweepPendingNotifications would do if it raced the first delivery).
        const records = await pool.query<{ id: string }>(
          "select id from notifications where idempotency_key = $1",
          [`evt:singleton:${tag}:request.accepted:${user.id}`]
        );
        const notificationId = records.rows[0]?.id;
        expect(notificationId).toBeTruthy();
        await queueClient2.send(
          "notify.send",
          { notificationId },
          { singletonKey: `notify:${notificationId}`, policy: "singleton" }
        );

        // Don't assert until BOTH the original and the duplicate job have actually run — the
        // duplicate is serialized behind the first, not dropped, so it should complete too (its
        // deliverNotification call is just a no-op thanks to the status === "sent" guard).
        // Asserting after only the first `handledCount >= 1` could pass before the serialized
        // duplicate had even started.
        await waitUntil(() => handledCount >= 2, 10_000);

        expect(handledCount).toBe(2);
        expect(maxInFlight).toBe(1);
        expect(sent1.length + sent2.length).toBe(1);

        const finalRow = await dbClient1.notifications.getById(notificationId as string);
        expect(finalRow?.status).toBe("sent");
      },
      // Two serialized 1500ms handler sleeps (original, then the duplicate once the first
      // frees the singleton slot) plus polling delay and several DB round-trips comfortably
      // exceed Vitest's default 5000ms per-test timeout.
      20_000
    );
  });
});
