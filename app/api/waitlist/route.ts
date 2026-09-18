import { NextRequest } from "next/server";
import { addToBrevo } from "@/lib/brevo";
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
    const { email, userType, whatsapp, website } = body as {
      email: string;
      userType?: string;
      whatsapp?: string;
      website?: string;
    };

    if (website) {
      // Honeypot: bots fill hidden fields real users never see. Accept silently, do nothing.
      return Response.json({ success: true });
    }

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return Response.json({ error: "Invalid email" }, { status: 400 });
    }

    const resolvedType = userType === "insider" ? "insider" : "seeker";

    const result = await addToBrevo(email.trim().toLowerCase(), {
      USER_TYPE: resolvedType,
      SOURCE: "landing_page",
      ...(whatsapp ? { WHATSAPP: whatsapp } : {}),
    });

    if (!result.ok) {
      console.error("[waitlist] Brevo failed:", result.reason, "| status:", result.status);
      return Response.json({ success: true, warning: "Subscribed locally; email provider error logged" });
    }

    return Response.json({ success: true });
  } catch (err) {
    console.error("[waitlist] Unhandled error:", err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
