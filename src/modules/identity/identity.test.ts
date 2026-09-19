import { describe, it, expect, vi } from "vitest";
import { createFakeDatabase } from "../../adapters/db/fake";
import { createFakeAuthAdapter } from "../../adapters/auth/fake";
import {
  signInWithFirebaseToken,
  startWorkEmailOtp,
  verifyWorkEmailOtp,
  WorkEmailDomainError,
  type IdentityDeps,
} from "./identity";

function makeDeps(): { deps: IdentityDeps; issueToken: ReturnType<typeof createFakeAuthAdapter>["issueToken"]; seedCompany: ReturnType<typeof createFakeDatabase>["seedCompany"] } {
  const { db, seedCompany } = createFakeDatabase();
  const { adapter, issueToken } = createFakeAuthAdapter();
  return { deps: { db, auth: adapter }, issueToken, seedCompany };
}

describe("signInWithFirebaseToken", () => {
  it("creates a new seeker user on first sign-in", async () => {
    const { deps, issueToken } = makeDeps();
    const token = issueToken({ providerUid: "fb-1", email: "a@b.com" });
    const session = await signInWithFirebaseToken(deps, token);
    expect(session.role).toBe("seeker");
    expect(session.userId).toBeTruthy();
  });

  it("returns the same user on repeated sign-in with the same token identity", async () => {
    const { deps, issueToken } = makeDeps();
    const token = issueToken({ providerUid: "fb-2", email: "b@b.com" });
    const first = await signInWithFirebaseToken(deps, token);
    const second = await signInWithFirebaseToken(deps, token);
    expect(second.userId).toBe(first.userId);
  });

  it("rejects an invalid token", async () => {
    const { deps } = makeDeps();
    await expect(signInWithFirebaseToken(deps, "garbage")).rejects.toThrow();
  });
});

describe("startWorkEmailOtp", () => {
  it("creates an insider profile and a code when the domain is registered", async () => {
    const { deps, seedCompany } = makeDeps();
    seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const result = await startWorkEmailOtp(deps, "user-1", "person@acme.com");
    expect(result.insiderProfileId).toBeTruthy();
    expect(result.code).toMatch(/^\d{6}$/);
  });

  it("rejects a work email whose domain has no registered company", async () => {
    const { deps } = makeDeps();
    await expect(startWorkEmailOtp(deps, "user-1", "person@unknown.com")).rejects.toThrow(WorkEmailDomainError);
  });

  it("rejects a malformed email with no domain", async () => {
    const { deps } = makeDeps();
    await expect(startWorkEmailOtp(deps, "user-1", "not-an-email")).rejects.toThrow();
  });
});

describe("verifyWorkEmailOtp", () => {
  it("verifies the insider profile when the code matches", async () => {
    const { deps, seedCompany } = makeDeps();
    seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const { insiderProfileId, code } = await startWorkEmailOtp(deps, "user-1", "person@acme.com");
    const ok = await verifyWorkEmailOtp(deps, insiderProfileId, code);
    expect(ok).toBe(true);
  });

  it("rejects a wrong code", async () => {
    const { deps, seedCompany } = makeDeps();
    seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const { insiderProfileId } = await startWorkEmailOtp(deps, "user-1", "person@acme.com");
    const ok = await verifyWorkEmailOtp(deps, insiderProfileId, "000000");
    expect(ok).toBe(false);
  });

  it("rejects reusing an already-consumed code", async () => {
    const { deps, seedCompany } = makeDeps();
    seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const { insiderProfileId, code } = await startWorkEmailOtp(deps, "user-1", "person@acme.com");
    expect(await verifyWorkEmailOtp(deps, insiderProfileId, code)).toBe(true);
    expect(await verifyWorkEmailOtp(deps, insiderProfileId, code)).toBe(false);
  });

  it("rejects an expired code", async () => {
    vi.useFakeTimers();
    const { deps, seedCompany } = makeDeps();
    seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const { insiderProfileId, code } = await startWorkEmailOtp(deps, "user-1", "person@acme.com");
    vi.advanceTimersByTime(11 * 60 * 1000);
    expect(await verifyWorkEmailOtp(deps, insiderProfileId, code)).toBe(false);
    vi.useRealTimers();
  });
});
