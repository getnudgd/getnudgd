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
