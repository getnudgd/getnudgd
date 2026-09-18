export interface JobHandler<T = unknown> {
  (payload: T): Promise<void>;
}

export interface QueueClient {
  start(): Promise<void>;
  stop(): Promise<void>;
  send(queueName: string, payload: unknown): Promise<string | null>;
  work(queueName: string, handler: JobHandler): Promise<void>;
}
