export interface JobHandler<T = unknown> {
  (payload: T): Promise<void>;
}

export interface SendOptions {
  /**
   * A label for the job. Against the real pg-boss client (queue.real.ts),
   * queues are created under pg-boss's default "standard" policy, under which
   * singletonKey is NOT a uniqueness/dedup constraint — pg-boss will still
   * happily enqueue duplicates with the same key. "Runs once" safety comes
   * from the domain layer's own idempotent state checks (e.g. requests.expire()
   * re-checking the request is still SENT before acting), not from this key.
   */
  singletonKey?: string;
  startAfterSeconds?: number;
  /** Maximum number of retry attempts pg-boss makes after the first failure. */
  retryLimit?: number;
  /** When true, pg-boss backs off exponentially between retries instead of a fixed delay. */
  retryBackoff?: boolean;
}

export interface QueueClient {
  /**
   * Contract: callers must call start() before work(), schedule(), or send()
   * against the real client (queue.real.ts) — pg-boss requires the database
   * connection to already be open before queues can be created/used.
   */
  start(): Promise<void>;
  stop(): Promise<void>;
  send(queueName: string, payload: unknown, options?: SendOptions): Promise<string | null>;
  work(queueName: string, handler: JobHandler): Promise<void>;
  schedule(queueName: string, cron: string, payload: unknown): Promise<void>;
}
