import { NextRequest } from "next/server";

// ── Rate limit store ──────────────────────────────────────────────────────────
// In-memory Map: ip → array of request timestamps within the current window
const rateLimitMap = new Map<string, number[]>();

function rateLimit(ip: string, maxRequests = 5, windowMs = 60_000): boolean {
  const now = Date.now();
  const windowStart = now - windowMs;
  const requests = (rateLimitMap.get(ip) ?? []).filter((t) => t > windowStart);
  if (requests.length >= maxRequests) return false;
  requests.push(now);
  rateLimitMap.set(ip, requests);
  return true;
}

// ── Exported guard ────────────────────────────────────────────────────────────
// Returns a Response if the request should be rejected, null if it passes.
export function guardRequest(req: NextRequest): Response | null {
  // 1. Secret token check
  const secret = req.headers.get("x-api-secret");
  if (!secret || secret !== process.env.API_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Rate limit — prefer x-forwarded-for (set by Vercel) then fallback
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  if (!rateLimit(ip)) {
    return Response.json({ error: "Too many requests" }, { status: 429 });
  }

  return null;
}
