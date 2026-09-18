import { NextRequest } from "next/server";
import { submitToSheets } from "@/lib/gas";
import { isSameOrigin } from "@/src/lib/same-origin";
import { createInMemoryRateLimiter } from "@/src/lib/ratelimit";

const rateLimiter = createInMemoryRateLimiter(5, 60_000);

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  if (!rateLimiter.check(ip)) {
    return Response.json({ error: "Too many requests" }, { status: 429 });
  }

  try {
    const body = await req.json();
    const { answers, submittedAt, website } = body as {
      answers: Record<string, unknown>;
      submittedAt: string;
      website?: string;
    };

    if (website) {
      return Response.json({ success: true });
    }

    if (!answers || typeof answers !== "object") {
      return Response.json({ error: "Invalid payload" }, { status: 400 });
    }

    const result = await submitToSheets({ answers, submittedAt });

    if (!result.ok) {
      console.error("[survey] GAS failed:", result.reason, "| status:", result.status);
      return Response.json({ success: true, warning: "Response logged; Sheets write failed" });
    }

    return Response.json({ success: true });
  } catch (err) {
    console.error("[survey] Unhandled error:", err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
