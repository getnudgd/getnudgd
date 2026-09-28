import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const sendCalls = vi.hoisted(
  () => [] as Array<{ queueName: string; payload: unknown; options: Record<string, unknown> }>,
);
const createQueueCalls = vi.hoisted(
  () => [] as Array<{ queueName: string; options: Record<string, unknown> | undefined }>,
);
const workCalls = vi.hoisted(
  () => [] as Array<{ queueName: string; options: Record<string, unknown> }>,
);
// Simulates pg-boss's real ON CONFLICT DO NOTHING createQueue: the first call for a queue
// name wins and sets its stored policy; later calls for the same name are no-ops. Tests can
// pre-seed this map directly (bypassing createQueue) to simulate a queue that pre-existed
// under a different policy before this fix, the way this repo's own dev database did.
const storedQueuePolicies = vi.hoisted(() => new Map<string, string>());

vi.mock("pg-boss", () => {
  class PgBoss {
    async start() {}
    async stop() {}
    async createQueue(queueName: string, options?: Record<string, unknown>) {
      createQueueCalls.push({ queueName, options });
      if (!storedQueuePolicies.has(queueName)) {
        storedQueuePolicies.set(queueName, (options?.policy as string | undefined) ?? "standard");
      }
    }
    async getQueue(queueName: string) {
      if (!storedQueuePolicies.has(queueName)) return null;
      return { name: queueName, policy: storedQueuePolicies.get(queueName) };
    }
    async work(queueName: string, optionsOrHandler: unknown, _handler?: unknown) {
      const options = typeof optionsOrHandler === "function" ? {} : (optionsOrHandler as Record<string, unknown>) ?? {};
      workCalls.push({ queueName, options });
    }
    async schedule() {}
    async send(queueName: string, payload: unknown, options: Record<string, unknown>) {
      sendCalls.push({ queueName, payload, options });
      return "job-1";
    }
  }
  return { PgBoss };
});

import { createRealQueueClient } from "./queue.real";

describe("createRealQueueClient send()", () => {
  beforeEach(() => {
    sendCalls.length = 0;
    createQueueCalls.length = 0;
    workCalls.length = 0;
    storedQueuePolicies.clear();
  });

  it("passes no option keys at all when the caller sets no options", async () => {
    const client = createRealQueueClient("postgres://unused");
    await client.send("q", { a: 1 });

    expect(sendCalls).toHaveLength(1);
    const opts = sendCalls[0].options;
    expect("retryLimit" in opts).toBe(false);
    expect("retryBackoff" in opts).toBe(false);
    expect("singletonKey" in opts).toBe(false);
    expect("startAfter" in opts).toBe(false);
    expect(Object.keys(opts)).toEqual([]);
  });

  it("passes only startAfter and singletonKey for a delayed request-expire job", async () => {
    const client = createRealQueueClient("postgres://unused");
    await client.send(
      "request.expire",
      { requestId: "r1" },
      { startAfterSeconds: 172800, singletonKey: "request:r1:expire" },
    );

    const opts = sendCalls[0].options;
    expect(Object.keys(opts).sort()).toEqual(["singletonKey", "startAfter"]);
    expect(opts.startAfter).toBe(172800);
    expect(opts.singletonKey).toBe("request:r1:expire");
    expect("retryLimit" in opts).toBe(false);
    expect("retryBackoff" in opts).toBe(false);
  });

  it("passes retry options through when the caller sets them", async () => {
    const client = createRealQueueClient("postgres://unused");
    await client.send(
      "notify.send",
      { id: "n1" },
      { retryLimit: 3, retryBackoff: true, singletonKey: "notify:n1" },
    );

    const opts = sendCalls[0].options;
    expect(opts.retryLimit).toBe(3);
    expect(opts.retryBackoff).toBe(true);
    expect(opts.singletonKey).toBe("notify:n1");
    expect("startAfter" in opts).toBe(false);
  });

  it("creates the queue with policy: singleton when the caller passes { policy: 'singleton' }", async () => {
    const client = createRealQueueClient("postgres://unused");
    await client.send("notify.send", { notificationId: "n1" }, { singletonKey: "notify:n1", policy: "singleton" });

    expect(createQueueCalls).toHaveLength(1);
    expect(createQueueCalls[0].queueName).toBe("notify.send");
    expect(createQueueCalls[0].options).toEqual({ policy: "singleton" });
  });

  it("creates the queue with no policy key at all when the caller sets no policy option", async () => {
    const client = createRealQueueClient("postgres://unused");
    await client.send("q", { a: 1 });

    expect(createQueueCalls).toHaveLength(1);
    expect(createQueueCalls[0].queueName).toBe("q");
    expect(createQueueCalls[0].options === undefined || !("policy" in createQueueCalls[0].options)).toBe(true);
  });
});

describe("createRealQueueClient work()", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sendCalls.length = 0;
    createQueueCalls.length = 0;
    workCalls.length = 0;
    storedQueuePolicies.clear();
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("creates the queue with policy: singleton when work() is called with { policy: 'singleton' }", async () => {
    const client = createRealQueueClient("postgres://unused");
    await client.start();
    await client.work("notify.send", async () => {}, { policy: "singleton" });

    expect(createQueueCalls).toHaveLength(1);
    expect(createQueueCalls[0].queueName).toBe("notify.send");
    expect(createQueueCalls[0].options).toEqual({ policy: "singleton" });
  });

  it("creates the queue with no policy key at all when work() is called with no options", async () => {
    const client = createRealQueueClient("postgres://unused");
    await client.start();
    await client.work("request.expire", async () => {});

    expect(createQueueCalls).toHaveLength(1);
    expect(createQueueCalls[0].queueName).toBe("request.expire");
    expect(createQueueCalls[0].options === undefined || !("policy" in createQueueCalls[0].options)).toBe(true);
  });

  it("passes pollingIntervalSeconds through to boss.work() when set", async () => {
    const client = createRealQueueClient("postgres://unused");
    await client.start();
    await client.work("test-queue", async () => {}, { pollingIntervalSeconds: 0.5 });

    expect(workCalls).toHaveLength(1);
    expect(workCalls[0].queueName).toBe("test-queue");
    expect(workCalls[0].options).toEqual({ pollingIntervalSeconds: 0.5 });
  });

  it("passes no pollingIntervalSeconds key at all when the caller doesn't set it", async () => {
    const client = createRealQueueClient("postgres://unused");
    await client.start();
    await client.work("request.expire", async () => {});

    expect(workCalls).toHaveLength(1);
    expect("pollingIntervalSeconds" in workCalls[0].options).toBe(false);
  });

  it("does not warn when a freshly-created queue's stored policy matches the requested policy", async () => {
    const client = createRealQueueClient("postgres://unused");
    await client.start();
    await client.work("notify.send", async () => {}, { policy: "singleton" });

    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("logs a console.error naming the queue, requested policy, and actual policy when they mismatch (pre-existing queue under a different policy)", async () => {
    // Simulates this repo's own dev database: notify.send already exists under "standard"
    // from before this fix, so createQueue's ON CONFLICT DO NOTHING silently keeps it there.
    storedQueuePolicies.set("notify.send", "standard");
    const client = createRealQueueClient("postgres://unused");
    await client.start();

    await expect(client.work("notify.send", async () => {}, { policy: "singleton" })).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const message = errorSpy.mock.calls[0].join(" ");
    expect(message).toContain("notify.send");
    expect(message).toContain("standard");
    expect(message).toContain("singleton");
  });
});
