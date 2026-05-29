import { NextRequest } from "next/server";
import { submitToSheets } from "@/lib/gas";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { answers, submittedAt } = body as {
      answers: Record<string, unknown>;
      submittedAt: string;
    };

    await submitToSheets({ answers, submittedAt });

    return Response.json({ success: true });
  } catch (err) {
    console.error("[survey] Error:", err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
