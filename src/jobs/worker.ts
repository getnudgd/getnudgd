import type { QueueClient } from "./queue";

export async function startWorker(queue: QueueClient): Promise<void> {
  await queue.start();
  console.log("[worker] started, no job handlers registered yet (Phase 1+)");
}
