export async function submitToSheets(data: object) {
  const url = process.env.GAS_WEBHOOK_URL;
  if (!url) {
    console.warn("[gas] GAS_WEBHOOK_URL not set — skipping");
    return;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    console.error("[gas] Error submitting to sheets:", res.status);
  }
}
