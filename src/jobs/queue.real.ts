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

      // createQueue is ON CONFLICT DO NOTHING: on a database where this queue name was
      // already created (e.g. under "standard", before this fix shipped), the createQueue
      // call above silently did nothing and the requested policy never took effect. That
      // failure mode is otherwise invisible — today's other mitigations (single worker,
      // deliverNotification's own status === "sent" guard) still hold even with the wrong
      // policy, so this is a loud warning, not a hard failure; it must never crash the worker.
      if (options?.policy !== undefined) {
        try {
          const actual = await boss.getQueue(queueName);
          const actualPolicy = actual?.policy ?? "standard";
          if (actualPolicy !== options.policy) {
            console.error(
              `[queue] "${queueName}" is registered with policy "${actualPolicy}" but this work() call ` +
                `requested policy "${options.policy}" — createQueue() cannot change an existing queue's ` +
                `policy (it is ON CONFLICT DO NOTHING, and pg-boss's updateQueue() refuses policy changes). ` +
                `Delete and recreate the queue (e.g. boss.deleteQueue("${queueName}") while idle, or the ` +
                `equivalent SQL fixup) to actually apply "${options.policy}".`
            );
          }
        } catch (err) {
          // A failure to verify (e.g. a transient connection blip) should log and move on, not
          // throw out of work() — this check is a diagnostic, not a correctness gate.
          console.error(`[queue] could not verify policy for "${queueName}"`, err);
        }
      }

      // pollingIntervalSeconds is a WorkOptions field on pg-boss's boss.work(), not a
      // constructor/instance-wide setting (see the doc on QueueClient.work()'s options in
      // queue.ts) — only include it when the caller set it, matching the omission pattern
      // used elsewhere in this file.
      const workOptions: { pollingIntervalSeconds?: number } = {};
      if (options?.pollingIntervalSeconds !== undefined) {
        workOptions.pollingIntervalSeconds = options.pollingIntervalSeconds;
      }
      await boss.work(queueName, workOptions, async (jobs) => {
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
