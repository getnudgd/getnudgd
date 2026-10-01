import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const MAILBOX_PATH = path.join(process.cwd(), ".playwright-mailbox.jsonl");

export default defineConfig({
  testDir: "./tests/e2e-browser",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:3100",
    // devLoginLimiter is keyed by IP alone pre-auth; every test in this run shares this one
    // "IP" and therefore this one rate-limit bucket (5 logins/minute). The current 4 tests
    // stay under that. Adding a 5th test, or a Playwright retry, pushes over it — if that
    // happens, give each test its own value here instead of raising the limit.
    extraHTTPHeaders: { "x-forwarded-for": "127.0.0.1" },
  },
  webServer: {
    command: "npm run dev -- -p 3100",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      NODE_ENV: "development",
      ADAPTERS: "real",
      DEV_LOGIN_ENABLED: "true",
      DEV_MAILBOX_PATH: MAILBOX_PATH,
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
