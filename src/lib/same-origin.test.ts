import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { isSameOrigin } from "./same-origin";

function makeRequest(headers: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost:3000/api/waitlist", { method: "POST", headers });
}

describe("isSameOrigin", () => {
  it("allows a request whose Origin host matches the request Host", () => {
    expect(isSameOrigin(makeRequest({ origin: "http://localhost:3000", host: "localhost:3000" }))).toBe(true);
  });

  it("rejects a request whose Origin host differs from the request Host", () => {
    expect(isSameOrigin(makeRequest({ origin: "http://evil.example", host: "localhost:3000" }))).toBe(false);
  });

  it("allows a request with no Origin header (defense in depth handles the rest)", () => {
    expect(isSameOrigin(makeRequest({ host: "localhost:3000" }))).toBe(true);
  });

  it("rejects a request with a malformed Origin header", () => {
    expect(isSameOrigin(makeRequest({ origin: "not-a-url", host: "localhost:3000" }))).toBe(false);
  });
});
