import { getHealthReport } from "@/src/lib/health";
import { createFakeDatabase } from "@/src/adapters/db/fake";
import { createFakeStorageAdapter } from "@/src/adapters/storage/fake";
import { createFakeQueueClient } from "@/src/jobs/queue.fake";

export async function GET() {
  // Phase 0 wires fakes directly; Phase 1 introduces a src/lib/adapters.ts
  // factory that switches on env.ADAPTERS ("fake" | "real") once real.ts
  // implementations exist for storage and the queue.
  const { db } = createFakeDatabase();
  const storage = createFakeStorageAdapter();
  const queue = createFakeQueueClient();
  await queue.start();

  const report = await getHealthReport({ db, storage, queue });
  return Response.json(report, { status: report.ok ? 200 : 503 });
}
