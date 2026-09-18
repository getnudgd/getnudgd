import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

vi.mock("@/lib/brevo", () => ({ addToBrevo: vi.fn(async () => ({ ok: true })) }));

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3000/api/waitlist", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", host: "localhost:3000", ...headers },
  });
}

describe("POST /api/waitlist", () => {
  it("accepts a same-origin request with a valid email", async () => {
    const res = await POST(makeRequest({ email: "a@b.com", userType: "seeker" }, { origin: "http://localhost:3000" }));
    expect(res.status).toBe(200);
  });

  it("rejects a cross-origin request", async () => {
    const res = await POST(makeRequest({ email: "a@b.com" }, { origin: "http://evil.example" }));
    expect(res.status).toBe(403);
  });

  it("silently accepts but skips Brevo when the honeypot field is filled", async () => {
    const { addToBrevo } = await import("@/lib/brevo");
    const res = await POST(makeRequest({ email: "a@b.com", website: "http://spam.example" }, { origin: "http://localhost:3000" }));
    expect(res.status).toBe(200);
    expect(addToBrevo).not.toHaveBeenCalled();
  });

  it("rejects an invalid email", async () => {
    const res = await POST(makeRequest({ email: "not-an-email" }, { origin: "http://localhost:3000" }));
    expect(res.status).toBe(400);
  });

  it("never includes a _debug field in the response body", async () => {
    const res = await POST(makeRequest({ email: "a@b.com" }, { origin: "http://localhost:3000" }));
    const body = await res.json();
    expect(body._debug).toBeUndefined();
  });

  it("maps userType to locked-vocabulary values, defaulting to seeker", async () => {
    const { addToBrevo } = await import("@/lib/brevo");
    await POST(makeRequest({ email: "a@b.com", userType: "insider" }, { origin: "http://localhost:3000" }));
    expect(addToBrevo).toHaveBeenCalledWith("a@b.com", expect.objectContaining({ USER_TYPE: "insider" }));
  });
});
