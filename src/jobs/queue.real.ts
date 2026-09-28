import { PgBoss } from "pg-boss";
import type { QueueClient, QueuePolicy } from "./queue";

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
      // pg-boss's createQueue is ON CONFLICT DO NOTHING, so this only sets the
      // policy the first time this queue name is ever created in this database
      // (see the QueuePolicy/SendOptions.policy doc in queue.ts). Only include
      // the `policy` key when set, matching the pattern below for send options.
      const createOptions: { policy?: QueuePolicy } = {};
      if (options?.policy !== undefined) createOptions.policy = options.policy;
      await boss.createQueue(queueName, createOptions);
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
    async work(queueName, handler, options) {
      const createOptions: { policy?: QueuePolicy } = {};
      if (options?.policy !== undefined) createOptions.policy = options.policy;
      await boss.createQueue(queueName, createOptions);
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
