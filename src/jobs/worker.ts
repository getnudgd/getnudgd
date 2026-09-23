import { z } from "zod";
import type { Database } from "../adapters/db/types";
import type { QueueClient } from "./queue";
import { expire, sweepExpiredSent, type RequestsDeps } from "../modules/requests/requests";

export interface WorkerDeps {
  db: Database;
  queue: QueueClient;
}

const requestExpirePayloadSchema = z.object({ requestId: z.string().min(1) });

export async function startWorker(deps: WorkerDeps): Promise<void> {
  const requestsDeps: RequestsDeps = { db: deps.db, queue: deps.queue };

  // Against the real pg-boss client, work()/schedule() call boss.createQueue()
  // internally, which requires the database connection to already be open —
  // only true after start(). start() must run before any work()/schedule()
  // registration below (see the contract note on QueueClient.start()).
  await deps.queue.start();

  await deps.queue.work("request.expire", async (payload) => {
    const { requestId } = requestExpirePayloadSchema.parse(payload);
    await expire(requestsDeps, requestId);
  });

  await deps.queue.work("requests.sweep", async () => {
    await sweepExpiredSent(requestsDeps, new Date());
  });
  await deps.queue.schedule("requests.sweep", "0 * * * *", {});

  console.log("[worker] started with request.expire and requests.sweep handlers registered");
}
