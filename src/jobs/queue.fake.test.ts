import { describe, it, expect, vi } from "vitest";
import { createFakeQueueClient } from "./queue.fake";

describe("createFakeQueueClient", () => {
  it("returns null and does not enqueue when send is called before start", async () => {
    const queue = createFakeQueueClient();
    const result = await queue.send("resume.parse", { id: "r1" });
    expect(result).toBeNull();
  });

  it("delivers sent payloads to a registered handler once started", async () => {
    const queue = createFakeQueueClient();
    const handler = vi.fn(async () => {});
    await queue.work("resume.parse", handler);
    await queue.start();
    const jobId = await queue.send("resume.parse", { id: "r1" });
    expect(jobId).not.toBeNull();
    expect(handler).toHaveBeenCalledWith({ id: "r1" });
  });

  it("accepts SendOptions without erroring and still delivers the payload", async () => {
    const queue = createFakeQueueClient();
    const handler = vi.fn(async () => {});
    await queue.work("request.expire", handler);
    await queue.start();
    const jobId = await queue.send(
      "request.expire",
      { requestId: "r1" },
      { singletonKey: "request:r1:expire", startAfterSeconds: 172800 }
    );
    expect(jobId).not.toBeNull();
    expect(handler).toHaveBeenCalledWith({ requestId: "r1" });
  });

  it("schedule does not throw and does not require start", async () => {
    const queue = createFakeQueueClient();
    await expect(queue.schedule("requests.sweep", "0 * * * *", {})).resolves.toBeUndefined();
  });
});
