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
    async send(queueName, payload, options) {
      await boss.createQueue(queueName);
      // pg-boss validates with `key in config`, so an explicit undefined value
      // throws. Only include keys the caller actually set.
      const bossOptions: {
        singletonKey?: string;
        startAfter?: number;
        retryLimit?: number;
        retryBackoff?: boolean;
      } = {};
      if (options?.singletonKey !== undefined) bossOptions.singletonKey = options.singletonKey;
      if (options?.startAfterSeconds !== undefined) bossOptions.startAfter = options.startAfterSeconds;
      if (options?.retryLimit !== undefined) bossOptions.retryLimit = options.retryLimit;
      if (options?.retryBackoff !== undefined) bossOptions.retryBackoff = options.retryBackoff;
      return boss.send(queueName, payload as object, bossOptions);
    },
    async work(queueName, handler) {
      await boss.createQueue(queueName);
      await boss.work(queueName, async (jobs) => {
        for (const job of jobs) {
          await handler(job.data);
        }
      });
    },
    async schedule(queueName, cron, payload) {
      await boss.createQueue(queueName);
      await boss.schedule(queueName, cron, payload as object);
    },
  };
}
