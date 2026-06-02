export type GasResult =
  | { ok: true }
  | { ok: false; status: number; body: string; reason: string };

export async function submitToSheets(data: object): Promise<GasResult> {
  const url = process.env.GAS_WEBHOOK_URL;

  if (!url) {
    console.warn("[gas] GAS_WEBHOOK_URL not set — skipping");
    return { ok: false, status: 0, body: "", reason: "GAS_WEBHOOK_URL not configured" };
  }

  console.log("[gas] Submitting to sheets, url prefix:", url.slice(0, 60));

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      // GAS requires redirect following (302 → final URL)
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(data),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error("[gas] Network error:", reason);
    return { ok: false, status: 0, body: "", reason };
  }

  const body = await res.text();
  console.log("[gas] Response status:", res.status, "body:", body.slice(0, 200));

  if (!res.ok) {
    console.error("[gas] Error submitting to sheets — status:", res.status, "body:", body);
    return { ok: false, status: res.status, body, reason: `GAS returned ${res.status}` };
  }

  return { ok: true };
}
