export interface JobHandler<T = unknown> {
  (payload: T): Promise<void>;
}

export interface SendOptions {
  singletonKey?: string;
  startAfterSeconds?: number;
}

export interface QueueClient {
  start(): Promise<void>;
  stop(): Promise<void>;
  send(queueName: string, payload: unknown, options?: SendOptions): Promise<string | null>;
  work(queueName: string, handler: JobHandler): Promise<void>;
  schedule(queueName: string, cron: string, payload: unknown): Promise<void>;
}
