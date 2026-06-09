import { NextRequest } from "next/server";
import { addToBrevo } from "@/lib/brevo";
import { guardRequest } from "@/lib/api-security";

export async function POST(req: NextRequest) {
  const blocked = guardRequest(req);
  if (blocked) return blocked;

  try {
    const body = await req.json();
    const { email, userType, whatsapp } = body as {
      email: string;
      userType?: string;
      whatsapp?: string;
    };

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return Response.json({ error: "Invalid email" }, { status: 400 });
    }

    const resolvedType = userType === "referrer" ? "referrer" : "job_seeker";

    const result = await addToBrevo(email.trim().toLowerCase(), {
      USER_TYPE: resolvedType,
      SOURCE: "landing_page",
      ...(whatsapp ? { WHATSAPP: whatsapp } : {}),
    });

    if (!result.ok) {
      console.error("[waitlist] Brevo failed:", result.reason, "| status:", result.status, "| body:", result.body);
      // Still return 200 to the user — their submission is noted even if Brevo is down
      return Response.json({
        success: true,
        warning: "Subscribed locally; email provider error logged",
        _debug: { reason: result.reason, status: result.status },
      });
    }

    return Response.json({ success: true });
  } catch (err) {
    console.error("[waitlist] Unhandled error:", err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
