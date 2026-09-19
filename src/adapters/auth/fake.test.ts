import { describe, it, expect } from "vitest";
import { createFakeAuthAdapter } from "./fake";
import { InvalidTokenError } from "./types";

describe("createFakeAuthAdapter", () => {
  it("round-trips an issued token back to the same identity", async () => {
    const { adapter, issueToken } = createFakeAuthAdapter();
    const token = issueToken({ providerUid: "fb-123", email: "a@b.com" });
    const identity = await adapter.verifyIdToken(token);
    expect(identity).toEqual({ providerUid: "fb-123", email: "a@b.com" });
  });

  it("rejects a malformed token", async () => {
    const { adapter } = createFakeAuthAdapter();
    await expect(adapter.verifyIdToken("not-a-real-token")).rejects.toThrow(InvalidTokenError);
  });

  it("rejects a token missing required fields", async () => {
    const { adapter } = createFakeAuthAdapter();
    const bogus = Buffer.from(JSON.stringify({ email: "a@b.com" })).toString("base64url");
    await expect(adapter.verifyIdToken(bogus)).rejects.toThrow(InvalidTokenError);
  });
});
