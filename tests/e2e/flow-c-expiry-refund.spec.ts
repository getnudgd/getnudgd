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
      30_000,
      `notification ${key} to reach status "sent"`
    );

    const emailsToSeeker = ctx.emailSent.filter((m) => m.to === seeker.email);
    expect(emailsToSeeker).toHaveLength(1);
  });
});
