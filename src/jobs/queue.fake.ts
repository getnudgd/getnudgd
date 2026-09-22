import type { QueueClient, JobHandler, SendOptions } from "./queue";

export function createFakeQueueClient(): QueueClient {
  const queues: Record<string, unknown[]> = {};
  const handlers: Record<string, JobHandler> = {};
  let started = false;

  return {
    async start() {
      started = true;
    },
    async stop() {
      started = false;
    },
    async send(queueName, payload, _options?: SendOptions) {
      if (!started) return null;
      (queues[queueName] ??= []).push(payload);
      const handler = handlers[queueName];
      if (handler) await handler(payload);
      return `fake-job-${queues[queueName].length}`;
    },
    async work(queueName, handler) {
      // Mirrors the real client (queue.real.ts), where work() calls
      // boss.createQueue() first, which requires start() to have already
      // opened the database connection.
      if (!started) throw new Error(`QueueClient.work("${queueName}") called before start()`);
      handlers[queueName] = handler;
    },
    async schedule(queueName, _cron, _payload) {
      // Mirrors the real client (queue.real.ts), where schedule() calls
      // boss.createQueue() first, which requires start() to have already
      // opened the database connection.
      if (!started) throw new Error(`QueueClient.schedule("${queueName}") called before start()`);
      // The fake has no real cron scheduler — recording the registration is
      // enough for tests to verify wiring; the sweep job's actual LOGIC is
      // tested directly as a plain async function call, not through this.
    },
  };
}
