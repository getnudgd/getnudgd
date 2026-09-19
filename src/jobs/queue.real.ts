import { PgBoss } from "pg-boss";
import type { QueueClient } from "./queue";

export function createRealQueueClient(connectionString: string): QueueClient {
  const boss = new PgBoss(connectionString);
  return {
    async start() {
      await boss.start();
    },
    async stop() {
      await boss.stop();
    },
    async send(queueName, payload) {
      await boss.createQueue(queueName);
      return boss.send(queueName, payload as object);
    },
    async work(queueName, handler) {
      await boss.createQueue(queueName);
      await boss.work(queueName, async (jobs) => {
        for (const job of jobs) {
          await handler(job.data);
        }
      });
    },
  };
}
