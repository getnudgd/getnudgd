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
  // 120s, not the smaller default: this is a shared, long-lived dev database. A
  // notify.send backlog left by earlier ad-hoc/live-test runs (which don't always
  // drain their own queue before exiting) can delay this run's own notification
  // deliveries well past a tight per-test budget — Flow C hit exactly this on
  // 2026-09-30 (a stale malformed row plus 6 others left the queue backed up, and
  // 10s wasn't enough; draining the backlog once fixed it, but the timeout must not
  // assume a clean queue going forward). Each flow's own waitUntil() calls (30s each)
  // are the first thing to fail with a clear message if delivery is ever genuinely
  // broken; this outer timeout only needs enough headroom above that not to cut a
  // flow off mid-wait, including Flow A's several sequential waits.
  timeout: 120_000,
});
