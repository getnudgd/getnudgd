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
    await queue.start();
    await queue.work("resume.parse", handler);
    const jobId = await queue.send("resume.parse", { id: "r1" });
    expect(jobId).not.toBeNull();
    expect(handler).toHaveBeenCalledWith({ id: "r1" });
  });

  it("accepts SendOptions without erroring and still delivers the payload", async () => {
    const queue = createFakeQueueClient();
    const handler = vi.fn(async () => {});
    await queue.start();
    await queue.work("request.expire", handler);
    const jobId = await queue.send(
      "request.expire",
      { requestId: "r1" },
      { singletonKey: "request:r1:expire", startAfterSeconds: 172800 }
    );
    expect(jobId).not.toBeNull();
    expect(handler).toHaveBeenCalledWith({ requestId: "r1" });
  });

  it("schedule throws when called before start, mirroring the real client's requirement", async () => {
    const queue = createFakeQueueClient();
    await expect(queue.schedule("requests.sweep", "0 * * * *", {})).rejects.toThrow();
  });

  it("schedule does not throw once started", async () => {
    const queue = createFakeQueueClient();
    await queue.start();
    await expect(queue.schedule("requests.sweep", "0 * * * *", {})).resolves.toBeUndefined();
  });

  it("work throws when called before start, mirroring the real client's requirement", async () => {
    const queue = createFakeQueueClient();
    await expect(queue.work("resume.parse", async () => {})).rejects.toThrow();
  });
});
