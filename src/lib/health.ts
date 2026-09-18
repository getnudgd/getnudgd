import type { Database } from "../adapters/db/types";
import type { StorageAdapter } from "../adapters/storage/types";
import type { QueueClient } from "../jobs/queue";

export interface HealthCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface HealthReport {
  ok: boolean;
  checks: HealthCheck[];
}

export interface HealthDeps {
  db: Database;
  storage: StorageAdapter;
  queue: QueueClient;
}

function toDetail(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function checkDb(db: Database): Promise<HealthCheck> {
  try {
    await db.config.getLatest("__health_probe__");
    return { name: "db", ok: true };
  } catch (err) {
    return { name: "db", ok: false, detail: toDetail(err) };
  }
}

async function checkStorage(storage: StorageAdapter): Promise<HealthCheck> {
  try {
    await storage.createSignedUploadUrl("health-check", "probe");
    return { name: "storage", ok: true };
  } catch (err) {
    return { name: "storage", ok: false, detail: toDetail(err) };
  }
}

async function checkQueue(queue: QueueClient): Promise<HealthCheck> {
  try {
    await queue.send("__health_probe__", { at: Date.now() });
    return { name: "queue", ok: true };
  } catch (err) {
    return { name: "queue", ok: false, detail: toDetail(err) };
  }
}

export async function getHealthReport(deps: HealthDeps): Promise<HealthReport> {
  const checks = await Promise.all([checkDb(deps.db), checkStorage(deps.storage), checkQueue(deps.queue)]);
  return { ok: checks.every((c) => c.ok), checks };
}
