import type { Database } from "../adapters/db/types";
import type { QueueClient } from "./queue";
import { expire, sweepExpiredSent, type RequestsDeps } from "../modules/requests/requests";

export interface WorkerDeps {
  db: Database;
  queue: QueueClient;
}

export async function startWorker(deps: WorkerDeps): Promise<void> {
  const requestsDeps: RequestsDeps = { db: deps.db, queue: deps.queue };

  await deps.queue.work("request.expire", async (payload) => {
    const { requestId } = payload as { requestId: string };
    await expire(requestsDeps, requestId);
  });

  await deps.queue.work("requests.sweep", async () => {
    await sweepExpiredSent(requestsDeps, new Date());
  });
  await deps.queue.schedule("requests.sweep", "0 * * * *", {});

  await deps.queue.start();
  console.log("[worker] started with request.expire and requests.sweep handlers registered");
}
