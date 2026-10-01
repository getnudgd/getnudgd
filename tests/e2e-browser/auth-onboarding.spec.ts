import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

const MAILBOX_PATH = path.join(process.cwd(), ".playwright-mailbox.jsonl");
const tag = Date.now().toString(36);

function readLatestOtpCode(workEmail: string): string {
  const lines = readFileSync(MAILBOX_PATH, "utf8").trim().split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const msg = JSON.parse(lines[i]) as { to: string; html: string };
    if (msg.to === workEmail) {
      const match = msg.html.match(/\d{6}/);
      if (match) return match[0];
    }
  }
  throw new Error(`No OTP email found for ${workEmail}`);
}

test.describe("auth and onboarding", () => {
  test("new Seeker signs in and lands on /seeker/dashboard", async ({ page }) => {
    const email = `seeker-${tag}-1@example.com`;
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Code").fill("000000");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/onboard/);
    await page.getByRole("button", { name: "I'm looking for a job" }).click();
    await page.getByLabel("Full name").fill("Playwright Seeker");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/seeker\/dashboard/);
  });

  test("new Insider signs in, verifies a work email via the dev mailbox, and lands on /insider/dashboard", async ({ page }) => {
    const loginEmail = `insider-${tag}-1@example.com`;
    const workEmail = `insider-${tag}-1@acme.com`;
    await page.goto("/login");
    await page.getByLabel("Email").fill(loginEmail);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Code").fill("000000");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/onboard/);
    await page.getByRole("button", { name: "I'm an Insider" }).click();
    await page.getByLabel("Full name").fill("Playwright Insider");
    await page.getByLabel("Work email").fill(workEmail);
    await page.getByRole("button", { name: "Send code" }).click();
    await expect(page.getByLabel("Code")).toBeVisible();

    const code = readLatestOtpCode(workEmail);
    await page.getByLabel("Code").fill(code);
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page).toHaveURL(/\/insider\/dashboard/);
  });

  test("a returning user signs in and lands directly on their dashboard, skipping /onboard", async ({ page }) => {
    const email = `returning-${tag}-1@example.com`;

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Code").fill("000000");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("button", { name: "I'm looking for a job" }).click();
    await page.getByLabel("Full name").fill("Returning Seeker");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/seeker\/dashboard/);

    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/^http:\/\/localhost:3100\/$/);

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Code").fill("000000");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/seeker\/dashboard/);
  });

  test("a signed-out visit to /seeker/dashboard redirects to /login", async ({ page }) => {
    await page.goto("/seeker/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });
});
