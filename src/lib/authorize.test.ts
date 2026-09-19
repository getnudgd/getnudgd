import { describe, it, expect } from "vitest";
import { authorize } from "./authorize";
import type { SessionPayload } from "./session";

const seekerSession: SessionPayload = { userId: "u1", role: "seeker", issuedAt: 0 };
const adminSession: SessionPayload = { userId: "admin-1", role: "admin", issuedAt: 0 };

describe("authorize", () => {
  it("denies when there is no session", () => {
    expect(authorize(null, "read", { type: "seekerProfile", ownerUserId: "u1" })).toBe(false);
  });

  it("allows a user to read their own resource", () => {
    expect(authorize(seekerSession, "read", { type: "seekerProfile", ownerUserId: "u1" })).toBe(true);
  });

  it("allows a user to update their own resource", () => {
    expect(authorize(seekerSession, "update", { type: "insiderProfile", ownerUserId: "u1" })).toBe(true);
  });

  it("denies a user accessing someone else's resource", () => {
    expect(authorize(seekerSession, "read", { type: "seekerProfile", ownerUserId: "u2" })).toBe(false);
  });

  it("allows admin to access any resource regardless of owner", () => {
    expect(authorize(adminSession, "update", { type: "seekerProfile", ownerUserId: "u1" })).toBe(true);
    expect(authorize(adminSession, "read", { type: "userRecord", ownerUserId: "someone-else" })).toBe(true);
  });

  it("allows a user to read their own resume", () => {
    expect(authorize(seekerSession, "read", { type: "resume", ownerUserId: "u1" })).toBe(true);
  });

  it("denies a user reading someone else's resume", () => {
    expect(authorize(seekerSession, "read", { type: "resume", ownerUserId: "u2" })).toBe(false);
  });
});
