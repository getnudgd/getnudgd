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
