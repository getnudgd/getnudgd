import { describe, it, expect } from "vitest";
import { encodeSession, decodeSession, type SessionPayload } from "./session";

const SECRET = "test-secret-at-least-32-characters-long";

describe("encodeSession / decodeSession", () => {
  it("round-trips a payload", () => {
    const payload: SessionPayload = { userId: "u1", role: "seeker", issuedAt: Date.now() };
    const token = encodeSession(payload, SECRET);
    expect(decodeSession(token, SECRET)).toEqual(payload);
  });

  it("rejects a token signed with a different secret", () => {
    const payload: SessionPayload = { userId: "u1", role: "seeker", issuedAt: Date.now() };
    const token = encodeSession(payload, SECRET);
    expect(decodeSession(token, "a-completely-different-secret-value")).toBeNull();
  });

  it("rejects a tampered payload segment", () => {
    const payload: SessionPayload = { userId: "u1", role: "seeker", issuedAt: Date.now() };
    const token = encodeSession(payload, SECRET);
    const [, signature] = token.split(".");
    const tamperedBody = Buffer.from(JSON.stringify({ userId: "u2", role: "admin", issuedAt: 0 })).toString("base64url");
    expect(decodeSession(`${tamperedBody}.${signature}`, SECRET)).toBeNull();
  });

  it("rejects a malformed token with no signature segment", () => {
    expect(decodeSession("not-a-valid-token", SECRET)).toBeNull();
  });

  it("rejects an empty token", () => {
    expect(decodeSession("", SECRET)).toBeNull();
  });
});
