import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

vi.mock("@/lib/gas", () => ({ submitToSheets: vi.fn(async () => ({ ok: true })) }));

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3000/api/survey", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", host: "localhost:3000", ...headers },
  });
}

describe("POST /api/survey", () => {
  it("accepts a same-origin request with valid answers", async () => {
    const res = await POST(
      makeRequest({ answers: { q1: "yes" }, submittedAt: "2026-01-01T00:00:00Z" }, { origin: "http://localhost:3000" })
    );
    expect(res.status).toBe(200);
  });

  it("rejects a cross-origin request", async () => {
    const res = await POST(makeRequest({ answers: {}, submittedAt: "x" }, { origin: "http://evil.example" }));
    expect(res.status).toBe(403);
  });

  it("rejects an invalid payload", async () => {
    const res = await POST(makeRequest({ answers: "not-an-object" }, { origin: "http://localhost:3000" }));
    expect(res.status).toBe(400);
  });

  it("silently accepts but skips submission when the honeypot field is filled", async () => {
    const { submitToSheets } = await import("@/lib/gas");
    const res = await POST(
      makeRequest({ answers: { q1: "yes" }, submittedAt: "x", website: "http://spam.example" }, { origin: "http://localhost:3000" })
    );
    expect(res.status).toBe(200);
    expect(submitToSheets).not.toHaveBeenCalled();
  });

  it("never includes a _debug field in the response body", async () => {
    const res = await POST(makeRequest({ answers: { q1: "yes" }, submittedAt: "x" }, { origin: "http://localhost:3000" }));
    const body = await res.json();
    expect(body._debug).toBeUndefined();
  });
});
