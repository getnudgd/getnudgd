export type BrevoResult =
  | { ok: true }
  | { ok: false; status: number; body: string; reason: string };

export async function addToBrevo(
  email: string,
  attrs?: Record<string, string | number | boolean>
): Promise<BrevoResult> {
  // Read inside the function so Vercel serverless always picks up env vars
  const apiKey = process.env.BREVO_API_KEY;
  const listId = process.env.BREVO_LIST_ID ? Number(process.env.BREVO_LIST_ID) : null;

  if (!apiKey) {
    console.warn("[brevo] BREVO_API_KEY not set");
    return { ok: false, status: 0, body: "", reason: "BREVO_API_KEY not configured" };
  }

  if (!listId) {
    console.warn("[brevo] BREVO_LIST_ID not set or invalid");
  }

  console.log("[brevo] Adding contact:", email, "listId:", listId);

  let res: Response;
  try {
    res = await fetch("https://api.brevo.com/v3/contacts", {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        email,
        listIds: listId ? [listId] : [],
        attributes: attrs ?? {},
        updateEnabled: true,
      }),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error("[brevo] Network error:", reason);
    return { ok: false, status: 0, body: "", reason };
  }

  // 201 = created, 204 = no content (contact already exists, updated)
  if (res.status === 201 || res.status === 204) {
    console.log("[brevo] Success, status:", res.status);
    return { ok: true };
  }

  const body = await res.text();
  console.error("[brevo] API error — status:", res.status, "body:", body);
  return { ok: false, status: res.status, body, reason: `Brevo returned ${res.status}` };
}
