import type { QueueClient, JobHandler } from "./queue";

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
    async send(queueName, payload) {
      if (!started) return null;
      (queues[queueName] ??= []).push(payload);
      const handler = handlers[queueName];
      if (handler) await handler(payload);
      return `fake-job-${queues[queueName].length}`;
    },
    async work(queueName, handler) {
      handlers[queueName] = handler;
    },
  };
}
