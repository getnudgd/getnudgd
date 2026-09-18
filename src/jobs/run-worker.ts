import { getEnv } from "../config/env";
import { createRealQueueClient } from "./queue.real";
import { startWorker } from "./worker";

const env = getEnv();
const queue = createRealQueueClient(env.DATABASE_URL);

startWorker(queue).catch((err) => {
  console.error("[worker] failed to start", err);
  process.exit(1);
});
