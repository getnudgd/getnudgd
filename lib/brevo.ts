const BREVO_API_KEY = process.env.BREVO_API_KEY;
const LIST_ID = Number(process.env.BREVO_LIST_ID);

export async function addToBrevo(
  email: string,
  attrs?: Record<string, string | number | boolean>
) {
  if (!BREVO_API_KEY) {
    console.warn("[brevo] BREVO_API_KEY not set — skipping");
    return;
  }

  const res = await fetch("https://api.brevo.com/v3/contacts", {
    method: "POST",
    headers: {
      "api-key": BREVO_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      listIds: LIST_ID ? [LIST_ID] : [],
      attributes: attrs,
      updateEnabled: true,
    }),
  });

  if (!res.ok && res.status !== 204) {
    const body = await res.text();
    console.error("[brevo] Error adding contact:", res.status, body);
  }
}
