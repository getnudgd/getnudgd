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

    const retried = await db.notifications.create({ userId, template: "request.accepted", payload: {}, idempotencyKey: `live:${tag}:retried` });
    await db.notifications.markFailed(retried.record.id, "boom");
    await db.notifications.markSent(retried.record.id, "email", when);
    const afterRetry = await db.notifications.getById(retried.record.id);
    expect(afterRetry?.status).toBe("sent");
    expect(afterRetry?.error).toBeNull();
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
