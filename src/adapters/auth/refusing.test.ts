import { describe, it, expect } from "vitest";
import { createRefusingAuthAdapter } from "./refusing";
import { InvalidTokenError } from "./types";

describe("createRefusingAuthAdapter", () => {
  it("rejects an arbitrary token", async () => {
    const { adapter } = createRefusingAuthAdapter();
    await expect(adapter.verifyIdToken("anything")).rejects.toThrow(InvalidTokenError);
  });

  it("rejects an otherwise well-formed fake token", async () => {
    const { adapter } = createRefusingAuthAdapter();
    const token = Buffer.from(JSON.stringify({ providerUid: "fb-1", email: "a@b.com" })).toString("base64url");
    await expect(adapter.verifyIdToken(token)).rejects.toThrow(InvalidTokenError);
  });
});
