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

    await addToBrevo(email.trim().toLowerCase(), {
      ...(role ? { ROLE: role } : {}),
      ...(whatsapp ? { WHATSAPP: whatsapp } : {}),
    });

    return Response.json({ success: true });
  } catch (err) {
    console.error("[waitlist] Error:", err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
