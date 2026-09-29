import { describe, it, expect } from "vitest";
import { createFakeDatabase } from "../adapters/db/fake";
import { createFakeEmailSender } from "../adapters/email/fake";
import { createFakeWhatsAppGateway } from "../adapters/whatsapp/fake";
import type { QueueClient, JobHandler } from "./queue";
import { startWorker } from "./worker";

const RULES_VALUE = {
  responseWindowHours: 48,
  interviewWindowDays: 14,
  reverificationDays: 90,
  tranche1Percent: 50,
  tranche2Percent: 50,
  refundPercentOnDecline: 100,
  refundPercentOnExpiry: 60,
  minRedemptionPoints: 500,
  panThresholdPoints: 5000,
  freeCreditGrant: 3,
  requestCostByTier: { tier1: 3, tier2: 2, tier3: 1 },
};

function makeSpyQueue(): {
  queue: QueueClient;
  handlers: Record<string, JobHandler>;
  scheduled: Array<{ queueName: string; cron: string }>;
  workCalls: Array<{ queueName: string; options?: { policy?: string } }>;
} {
  const handlers: Record<string, JobHandler> = {};
  const scheduled: Array<{ queueName: string; cron: string }> = [];
  const workCalls: Array<{ queueName: string; options?: { policy?: string } }> = [];
  const queue: QueueClient = {
    async start() {},
    async stop() {},
    async send() {
      return null;
    },
    async work(queueName, handler, options) {
      handlers[queueName] = handler;
      workCalls.push({ queueName, options });
    },
    async schedule(queueName, cron) {
      scheduled.push({ queueName, cron });
    },
  };
  return { queue, handlers, scheduled, workCalls };
}

describe("startWorker", () => {
  it("registers a handler for request.expire and requests.sweep, and schedules the sweep cron hourly", async () => {
    const { db } = createFakeDatabase();
    const { queue, handlers, scheduled } = makeSpyQueue();
    const { sender: email } = createFakeEmailSender();
    const { gateway: whatsapp } = createFakeWhatsAppGateway();

    await startWorker({ db, queue, email, whatsapp });

    expect(handlers["request.expire"]).toBeDefined();
    expect(handlers["requests.sweep"]).toBeDefined();
    expect(scheduled).toContainEqual({ queueName: "requests.sweep", cron: "0 * * * *" });
  });

  it("request.expire handler calls expire() for the given requestId", async () => {
    const { db, seedConfig, seedCompany } = createFakeDatabase();
    seedConfig({ key: "rules", version: 1, placeholder: true, value: RULES_VALUE });
    const company = seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const seekerUser = await db.identity.findOrCreateUser("fb-w-1", "w1@x.com", "seeker");
    const seekerProfile = await db.identity.createSeekerProfile(seekerUser.id, "Worker Seeker");
    await db.ledger.postTxn({
      idempotencyKey: "grant:w1",
      eventType: "credits.grant",
      entries: [
        { ownerType: "platform", ownerId: "platform", currency: "credits", amount: -5 },
        { ownerType: "seeker", ownerId: seekerProfile.id, currency: "credits", amount: 5 },
      ],
    });
    const insiderUser = await db.identity.findOrCreateUser("fb-w-2", "w2@acme.com", "seeker");
    const insiderProfile = await db.identity.findOrCreateInsiderProfile(insiderUser.id, company.id, "w2@acme.com");
    await db.identity.markInsiderVerified(insiderProfile.id, new Date());
    const request = await db.requests.sendRequest({
      idempotencyKey: "send:w1",
      seekerProfileId: seekerProfile.id,
      insiderProfileId: insiderProfile.id,
      companyId: company.id,
      creditCost: 3,
      rulesVersion: 1,
    });

    const { queue, handlers } = makeSpyQueue();
    const { sender: email } = createFakeEmailSender();
    const { gateway: whatsapp } = createFakeWhatsAppGateway();
    await startWorker({ db, queue, email, whatsapp });
    await handlers["request.expire"]({ requestId: request.id });

    const updated = await db.requests.getById(request.id);
    expect(updated?.state).toBe("EXPIRED");
  });

  it("requests.sweep handler is a no-op when there are no overdue requests", async () => {
    const { db, seedConfig } = createFakeDatabase();
    seedConfig({ key: "rules", version: 1, placeholder: true, value: RULES_VALUE });
    const { queue, handlers } = makeSpyQueue();
    const { sender: email } = createFakeEmailSender();
    const { gateway: whatsapp } = createFakeWhatsAppGateway();

    await startWorker({ db, queue, email, whatsapp });

    await expect(handlers["requests.sweep"]({})).resolves.toBeUndefined();
  });

  it("registers a handler for notify.send that calls deliverNotification", async () => {
    const { db } = createFakeDatabase();
    const user = await db.identity.findOrCreateUser("fb-w-notif", "wnotif@x.com", "seeker");
    const { record: notification } = await db.notifications.create({
      userId: user.id,
      template: "request.accepted",
      payload: { requestId: "r1", companyName: "Acme" },
      idempotencyKey: "seed:worker-notify",
    });
    const { queue, handlers, workCalls } = makeSpyQueue();
    const { sender: email, sent } = createFakeEmailSender();
    const { gateway: whatsapp } = createFakeWhatsAppGateway();

    await startWorker({ db, queue, email, whatsapp });
    await handlers["notify.send"]({ notificationId: notification.id });

    expect(sent).toHaveLength(1);
    const updated = await db.notifications.getById(notification.id);
    expect(updated?.status).toBe("sent");
    const notifySendCall = workCalls.find((c) => c.queueName === "notify.send");
    expect(notifySendCall?.options?.policy).toBe("singleton");
  });

  it("registers notifications.sweep, schedules it every 15 minutes, and the handler is a no-op for a fresh pending row", async () => {
    const { db } = createFakeDatabase();
    const user = await db.identity.findOrCreateUser("fb-w-sweep", "wsweep@x.com", "seeker");
    await db.notifications.create({
      userId: user.id,
      template: "request.accepted",
      payload: { requestId: "r1", companyName: "Acme" },
      idempotencyKey: "seed:worker-sweep",
    });
    const { queue, handlers, scheduled } = makeSpyQueue();
    const { sender: email } = createFakeEmailSender();
    const { gateway: whatsapp } = createFakeWhatsAppGateway();

    await startWorker({ db, queue, email, whatsapp });

    expect(handlers["notifications.sweep"]).toBeDefined();
    expect(scheduled).toContainEqual({ queueName: "notifications.sweep", cron: "*/15 * * * *" });
    await expect(handlers["notifications.sweep"]({})).resolves.toBeUndefined();
  });
});
