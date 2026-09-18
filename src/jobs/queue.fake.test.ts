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
});
