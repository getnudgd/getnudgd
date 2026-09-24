import { describe, it, expect, beforeEach, vi } from "vitest";

const sendCalls = vi.hoisted(
  () => [] as Array<{ queueName: string; payload: unknown; options: Record<string, unknown> }>,
);

vi.mock("pg-boss", () => {
  class PgBoss {
    async start() {}
    async stop() {}
    async createQueue() {}
    async work() {}
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
});
