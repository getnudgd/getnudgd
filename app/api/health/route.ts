import { getHealthReport } from "@/src/lib/health";
import { getAdapters } from "@/src/lib/adapters";

export async function GET() {
  const { db, storage, queue } = getAdapters();
  await queue.start();

  const report = await getHealthReport({ db, storage, queue });
  return Response.json(report, { status: report.ok ? 200 : 503 });
}
