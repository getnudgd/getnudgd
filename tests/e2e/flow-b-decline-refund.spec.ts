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
      30_000,
      `notification ${key} to reach status "sent"`
    );

    const emailsToSeeker = ctx.emailSent.filter((m) => m.to === seeker.email);
    expect(emailsToSeeker).toHaveLength(1);
  });
});
