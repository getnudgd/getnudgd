import { describe, it, expect, vi } from "vitest";
import { startWorker } from "./worker";
import { createFakeQueueClient } from "./queue.fake";

describe("startWorker", () => {
  it("starts the queue client", async () => {
    const queue = createFakeQueueClient();
    const startSpy = vi.spyOn(queue, "start");
    await startWorker(queue);
    expect(startSpy).toHaveBeenCalledOnce();
  });
});
