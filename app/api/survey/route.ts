import { NextRequest } from "next/server";
import { submitToSheets } from "@/lib/gas";
import { guardRequest } from "@/lib/api-security";

export async function POST(req: NextRequest) {
  const blocked = guardRequest(req);
  if (blocked) return blocked;

  try {
    const body = await req.json();
    const { answers, submittedAt } = body as {
      answers: Record<string, unknown>;
      submittedAt: string;
    };

    if (!answers || typeof answers !== "object") {
      return Response.json({ error: "Invalid payload" }, { status: 400 });
    }

    console.log("[survey] Received submission, keys:", Object.keys(answers).length);

    const result = await submitToSheets({ answers, submittedAt });

    if (!result.ok) {
      console.error("[survey] GAS failed:", result.reason, "| status:", result.status, "| body:", result.body);
      // Still return 200 — data is logged server-side even if Sheets write failed
      return Response.json({
        success: true,
        warning: "Response logged; Sheets write failed",
        _debug: { reason: result.reason, status: result.status },
      });
    }

    return Response.json({ success: true });
  } catch (err) {
    console.error("[survey] Unhandled error:", err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
