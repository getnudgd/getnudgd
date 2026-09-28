export interface JobHandler<T = unknown> {
  (payload: T): Promise<void>;
}

/**
 * A pg-boss queue-level policy (see createQueue()). "standard" (the default) allows
 * any number of jobs to be active at once. "singleton" enforces, via a partial unique
 * index, that at most one job with a given (queue name, singletonKey) may be in the
 * `active` state at a time, queue-wide, regardless of worker/process count.
 */
export type QueuePolicy = "standard" | "singleton";

export interface SendOptions {
  /**
   * A label for the job. Against the real pg-boss client (queue.real.ts), queues
   * are created under pg-boss's default "standard" policy unless the queue was
   * created with `policy: "singleton"`, in which case singletonKey plus the
   * singleton policy DOES prevent two jobs with the same key from being active
   * at once — see notify.send's registration. Under "standard", singletonKey is
   * NOT a uniqueness/dedup constraint — pg-boss will still happily enqueue
   * duplicates with the same key, and "runs once" safety comes from the domain
   * layer's own idempotent state checks (e.g. requests.expire() re-checking the
   * request is still SENT before acting), not from this key.
   */
  singletonKey?: string;
  startAfterSeconds?: number;
  /** Maximum number of retry attempts pg-boss makes after the first failure. */
  retryLimit?: number;
  /** When true, pg-boss backs off exponentially between retries instead of a fixed delay. */
  retryBackoff?: boolean;
  /**
   * Passed to the underlying queue's creation; only takes effect if this queue name
   * has never been created before in this database — pg-boss's createQueue is
   * ON CONFLICT DO NOTHING and updateQueue refuses to change policy after creation.
   */
  policy?: QueuePolicy;
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
  /**
   * `options.policy`, like `SendOptions.policy` on send(), only takes effect if this
   * queue name has never been created before in this database (createQueue is
   * ON CONFLICT DO NOTHING; updateQueue refuses to change policy after creation).
   */
  work(queueName: string, handler: JobHandler, options?: { policy?: QueuePolicy }): Promise<void>;
  schedule(queueName: string, cron: string, payload: unknown): Promise<void>;
}
