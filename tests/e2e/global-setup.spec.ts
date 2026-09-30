import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { createRealQueueClient } from "../../src/jobs/queue.real";
import { checkNotifySendBacklog } from "./global-setup";

test("checkNotifySendBacklog detects an outstanding notify.send job", async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const queue = createRealQueueClient(process.env.DATABASE_URL as string);
  await queue.start();

  const before = await checkNotifySendBacklog(pool);
  const jobId = await queue.send(
    "notify.send",
    { notificationId: "backlog-test-marker" },
    { singletonKey: `backlog-test-${Date.now()}` }
  );
  try {
    const after = await checkNotifySendBacklog(pool);
    expect(after).toBeGreaterThan(before);
  } finally {
    // Clean up so this test doesn't leave its own debris for the next run.
    if (jobId) await pool.query("delete from pgboss.job where id = $1", [jobId]);
    await queue.stop();
    await pool.end();
  }
});
