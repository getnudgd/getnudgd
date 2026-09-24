import { describe, it, expect, vi } from "vitest";
import { createFakeDatabase } from "../../adapters/db/fake";
import { createFakeQueueClient } from "../../jobs/queue.fake";
import { createFakeEmailSender } from "../../adapters/email/fake";
import { createFakeWhatsAppGateway } from "../../adapters/whatsapp/fake";
import type { QueueClient } from "../../jobs/queue";
import {
  notify,
  deliverNotification,
  sweepPendingNotifications,
  PENDING_SWEEP_AGE_MS,
  NotificationNotFoundError,
} from "./notifications";

describe("notify", () => {
  it("creates a pending notification row and enqueues notify.send with a singleton key and retry options", async () => {
    const { db } = createFakeDatabase();
    const user = await db.identity.findOrCreateUser("fb-n1", "n1@x.com", "seeker");
    const sentJobs: Array<{
      queueName: string;
      payload: { notificationId: string };
      options?: { singletonKey?: string; retryLimit?: number; retryBackoff?: boolean };
    }> = [];
    const spyQueue: QueueClient = {
      async start() {},
      async stop() {},
      async send(queueName, payload, options) {
        sentJobs.push({ queueName, payload: payload as { notificationId: string }, options });
        return "job-1";
      },
      async work() {},
      async schedule() {},
    };

    await notify({ db, queue: spyQueue }, user.id, "request.accepted", { requestId: "r1", companyName: "Acme" }, "evt:n1");

    expect(sentJobs).toHaveLength(1);
    expect(sentJobs[0].queueName).toBe("notify.send");
    const notificationId = sentJobs[0].payload.notificationId;
    expect(sentJobs[0].options?.singletonKey).toBe(`notify:${notificationId}`);
    expect(sentJobs[0].options?.retryLimit).toBe(3);
    expect(sentJobs[0].options?.retryBackoff).toBe(true);

    const record = await db.notifications.getById(notificationId);
    expect(record?.status).toBe("pending");
    expect(record?.userId).toBe(user.id);
    expect(record?.template).toBe("request.accepted");
    expect(record?.payload).toEqual({ requestId: "r1", companyName: "Acme" });
  });

  it("throws synchronously on a payload that fails the template's schema, without creating a row or enqueueing", async () => {
    const { db } = createFakeDatabase();
    const user = await db.identity.findOrCreateUser("fb-n2", "n2@x.com", "seeker");
    const queue = createFakeQueueClient();
    await queue.start();
    const sendSpy = vi.spyOn(queue, "send");
    const createSpy = vi.spyOn(db.notifications, "create");

    await expect(
      notify({ db, queue }, user.id, "request.accepted", { requestId: "r1" }, "evt:n2") // missing companyName
    ).rejects.toThrow();
    expect(sendSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("does not create a second row or enqueue a second job for the same event, template and user", async () => {
    const { db } = createFakeDatabase();
    const user = await db.identity.findOrCreateUser("fb-n-dup", "ndup@x.com", "seeker");
    const sent: string[] = [];
    const spyQueue: QueueClient = {
      async start() {},
      async stop() {},
      async send(queueName) {
        sent.push(queueName);
        return "job";
      },
      async work() {},
      async schedule() {},
    };
    const payload = { requestId: "r1", companyName: "Acme" };
    await notify({ db, queue: spyQueue }, user.id, "request.accepted", payload, "request:r1:accept");
    await notify({ db, queue: spyQueue }, user.id, "request.accepted", payload, "request:r1:accept");
    expect(sent.filter((q) => q === "notify.send")).toHaveLength(1);
  });

  it("notifies two different recipients of the same event and template", async () => {
    const { db } = createFakeDatabase();
    const a = await db.identity.findOrCreateUser("fb-n-a", "na@x.com", "seeker");
    const b = await db.identity.findOrCreateUser("fb-n-b", "nb@x.com", "seeker");
    const sent: string[] = [];
    const spyQueue: QueueClient = {
      async start() {},
      async stop() {},
      async send(queueName) {
        sent.push(queueName);
        return "job";
      },
      async work() {},
      async schedule() {},
    };
    const payload = { requestId: "r1", companyName: "Acme", audience: "seeker" };
    await notify({ db, queue: spyQueue }, a.id, "proof.verified", payload, "review:r1:k1");
    await notify({ db, queue: spyQueue }, b.id, "proof.verified", payload, "review:r1:k1");
    expect(sent.filter((q) => q === "notify.send")).toHaveLength(2);
  });
});

describe("deliverNotification", () => {
  async function seedPendingNotification(overrides?: { phone?: string }) {
    const { db } = createFakeDatabase();
    const user = await db.identity.findOrCreateUser(`fb-dn-${Math.random()}`, `dn${Math.random()}@x.com`, "seeker");
    if (overrides?.phone) await db.identity.setUserPhone(user.id, overrides.phone);
    const { record } = await db.notifications.create({
      userId: user.id,
      template: "request.accepted",
      payload: { requestId: "r1", companyName: "Acme" },
      idempotencyKey: `seed:${user.id}`,
    });
    return { db, user, record };
  }

  it("delivers via a WhatsApp session message when an active session exists", async () => {
    const { db, user, record } = await seedPendingNotification({ phone: "+911111111111" });
    const { sender: email } = createFakeEmailSender();
    const { gateway: whatsapp, setActiveSession, sentSessionMessages } = createFakeWhatsAppGateway();
    setActiveSession(user.id, true);

    await deliverNotification({ db, email, whatsapp }, record.id);

    expect(sentSessionMessages).toHaveLength(1);
    const updated = await db.notifications.getById(record.id);
    expect(updated?.status).toBe("sent");
    expect(updated?.channel).toBe("whatsapp_session");
  });

  it("falls back to a WhatsApp template message when there is no active session", async () => {
    const { db, record } = await seedPendingNotification({ phone: "+911111111111" });
    const { sender: email } = createFakeEmailSender();
    const { gateway: whatsapp, sentTemplateMessages } = createFakeWhatsAppGateway();

    await deliverNotification({ db, email, whatsapp }, record.id);

    expect(sentTemplateMessages).toHaveLength(1);
    const updated = await db.notifications.getById(record.id);
    expect(updated?.status).toBe("sent");
    expect(updated?.channel).toBe("whatsapp_template");
  });

  it("falls back to a WhatsApp template message when the session send fails", async () => {
    const { db, user, record } = await seedPendingNotification({ phone: "+911111111111" });
    const { sender: email, sent } = createFakeEmailSender();
    const { gateway: whatsapp, setActiveSession, setSessionSendFailure, sentSessionMessages, sentTemplateMessages } =
      createFakeWhatsAppGateway();
    setActiveSession(user.id, true);
    setSessionSendFailure("+911111111111", true);

    await deliverNotification({ db, email, whatsapp }, record.id);

    expect(sentSessionMessages).toHaveLength(0);
    expect(sentTemplateMessages).toHaveLength(1);
    expect(sent).toHaveLength(0);
    const updated = await db.notifications.getById(record.id);
    expect(updated?.status).toBe("sent");
    expect(updated?.channel).toBe("whatsapp_template");
  });

  it("does nothing for a notification that is already sent, so a retry never re-sends", async () => {
    const { db, user, record } = await seedPendingNotification({ phone: "+911111111111" });
    await db.notifications.markSent(record.id, "email", new Date("2026-01-01T00:00:00Z"));
    const before = { ...(await db.notifications.getById(record.id)) };
    const { sender: email, sent } = createFakeEmailSender();
    const { gateway: whatsapp, setActiveSession, sentSessionMessages, sentTemplateMessages } =
      createFakeWhatsAppGateway();
    setActiveSession(user.id, true);

    await deliverNotification({ db, email, whatsapp }, record.id);

    expect(sent).toHaveLength(0);
    expect(sentSessionMessages).toHaveLength(0);
    expect(sentTemplateMessages).toHaveLength(0);
    expect(await db.notifications.getById(record.id)).toEqual(before);
  });

  it("skips WhatsApp entirely and goes straight to email when the user has no phone on file", async () => {
    const { db, record } = await seedPendingNotification();
    const { sender: email, sent } = createFakeEmailSender();
    const { gateway: whatsapp, sentSessionMessages, sentTemplateMessages } = createFakeWhatsAppGateway();

    await deliverNotification({ db, email, whatsapp }, record.id);

    expect(sentSessionMessages).toHaveLength(0);
    expect(sentTemplateMessages).toHaveLength(0);
    expect(sent).toHaveLength(1);
    const updated = await db.notifications.getById(record.id);
    expect(updated?.status).toBe("sent");
    expect(updated?.channel).toBe("email");
  });

  it("falls back to email immediately when every WhatsApp attempt fails", async () => {
    const { db, record } = await seedPendingNotification({ phone: "+911111111111" });
    const { sender: email, sent } = createFakeEmailSender();
    const { gateway: whatsapp, setTemplateSendFailure } = createFakeWhatsAppGateway();
    setTemplateSendFailure("+911111111111", true);

    await deliverNotification({ db, email, whatsapp }, record.id);

    expect(sent).toHaveLength(1);
    const updated = await db.notifications.getById(record.id);
    expect(updated?.status).toBe("sent");
    expect(updated?.channel).toBe("email");
  });

  it("marks the notification failed and rethrows when every channel fails", async () => {
    const { db, record } = await seedPendingNotification({ phone: "+911111111111" });
    const failingEmail = {
      async send(): Promise<{ id: string }> {
        throw new Error("Brevo is down");
      },
    };
    const { gateway: whatsapp, setTemplateSendFailure } = createFakeWhatsAppGateway();
    setTemplateSendFailure("+911111111111", true);

    await expect(deliverNotification({ db, email: failingEmail, whatsapp }, record.id)).rejects.toThrow();

    const updated = await db.notifications.getById(record.id);
    expect(updated?.status).toBe("failed");
    expect(updated?.error).toContain("Brevo is down");
  });

  it("throws NotificationNotFoundError for an unknown notification id", async () => {
    const { db } = createFakeDatabase();
    const { sender: email } = createFakeEmailSender();
    const { gateway: whatsapp } = createFakeWhatsAppGateway();
    await expect(deliverNotification({ db, email, whatsapp }, "nope")).rejects.toThrow(NotificationNotFoundError);
  });
});

describe("sweepPendingNotifications", () => {
  function makeSpyQueue(failFor?: (notificationId: string) => boolean) {
    const sent: Array<{ notificationId: string; options?: { singletonKey?: string; retryLimit?: number; retryBackoff?: boolean } }> = [];
    const queue: QueueClient = {
      async start() {},
      async stop() {},
      async send(_queueName, payload, options) {
        const { notificationId } = payload as { notificationId: string };
        if (failFor?.(notificationId)) throw new Error("queue down");
        sent.push({ notificationId, options });
        return "job";
      },
      async work() {},
      async schedule() {},
    };
    return { queue, sent };
  }

  it("re-enqueues pending rows older than the sweep age with the standard singleton key and retry options", async () => {
    const { db } = createFakeDatabase();
    const user = await db.identity.findOrCreateUser("fb-sw-1", "sw1@x.com", "seeker");
    const { record } = await db.notifications.create({ userId: user.id, template: "request.accepted", payload: {}, idempotencyKey: "sw:1" });
    const { queue, sent } = makeSpyQueue();

    const count = await sweepPendingNotifications({ db, queue }, new Date(Date.now() + PENDING_SWEEP_AGE_MS + 1000));

    expect(count).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].notificationId).toBe(record.id);
    expect(sent[0].options?.singletonKey).toBe(`notify:${record.id}`);
    expect(sent[0].options?.retryLimit).toBe(3);
    expect(sent[0].options?.retryBackoff).toBe(true);
  });

  it("does not touch a pending row younger than the sweep age", async () => {
    const { db } = createFakeDatabase();
    const user = await db.identity.findOrCreateUser("fb-sw-2", "sw2@x.com", "seeker");
    await db.notifications.create({ userId: user.id, template: "request.accepted", payload: {}, idempotencyKey: "sw:2" });
    const { queue, sent } = makeSpyQueue();
    expect(await sweepPendingNotifications({ db, queue }, new Date())).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("does not re-enqueue rows that are already sent or failed", async () => {
    const { db } = createFakeDatabase();
    const user = await db.identity.findOrCreateUser("fb-sw-3", "sw3@x.com", "seeker");
    const s = await db.notifications.create({ userId: user.id, template: "request.accepted", payload: {}, idempotencyKey: "sw:3s" });
    const f = await db.notifications.create({ userId: user.id, template: "request.accepted", payload: {}, idempotencyKey: "sw:3f" });
    await db.notifications.markSent(s.record.id, "email", new Date());
    await db.notifications.markFailed(f.record.id, "boom");
    const { queue, sent } = makeSpyQueue();
    expect(await sweepPendingNotifications({ db, queue }, new Date(Date.now() + PENDING_SWEEP_AGE_MS + 1000))).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("keeps sweeping the remaining rows when the queue fails for one of them", async () => {
    const { db } = createFakeDatabase();
    const user = await db.identity.findOrCreateUser("fb-sw-4", "sw4@x.com", "seeker");
    const first = await db.notifications.create({ userId: user.id, template: "request.accepted", payload: {}, idempotencyKey: "sw:4a" });
    const second = await db.notifications.create({ userId: user.id, template: "request.accepted", payload: {}, idempotencyKey: "sw:4b" });
    const { queue, sent } = makeSpyQueue((id) => id === first.record.id);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const count = await sweepPendingNotifications({ db, queue }, new Date(Date.now() + PENDING_SWEEP_AGE_MS + 1000));

    expect(count).toBe(1);
    expect(sent.map((s) => s.notificationId)).toEqual([second.record.id]);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
