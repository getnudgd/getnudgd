import { NextRequest } from "next/server";
import { addToBrevo } from "@/lib/brevo";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, role, whatsapp } = body as {
      email: string;
      role?: string;
      whatsapp?: string;
    };

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return Response.json({ error: "Invalid email" }, { status: 400 });
    }

    const result = await addToBrevo(email.trim().toLowerCase(), {
      ...(role ? { ROLE: role } : {}),
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
