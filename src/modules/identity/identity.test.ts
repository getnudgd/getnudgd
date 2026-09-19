import { describe, it, expect, vi } from "vitest";
import { createFakeDatabase } from "../../adapters/db/fake";
import { createFakeAuthAdapter } from "../../adapters/auth/fake";
import {
  signInWithFirebaseToken,
  startWorkEmailOtp,
  verifyWorkEmailOtp,
  promoteRoleForInsiderVerification,
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

describe("promoteRoleForInsiderVerification", () => {
  it("promotes a seeker to both", () => {
    expect(promoteRoleForInsiderVerification("seeker")).toBe("both");
  });

  it("leaves insider unchanged", () => {
    expect(promoteRoleForInsiderVerification("insider")).toBe("insider");
  });

  it("leaves both unchanged", () => {
    expect(promoteRoleForInsiderVerification("both")).toBe("both");
  });

  it("leaves admin unchanged", () => {
    expect(promoteRoleForInsiderVerification("admin")).toBe("admin");
  });
});

describe("verifyWorkEmailOtp role promotion", () => {
  it("promotes a seeker to \"both\" on successful verification", async () => {
    const { deps, issueToken, seedCompany } = makeDeps();
    seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const token = issueToken({ providerUid: "fb-rolep-1", email: "rolep1@acme.com" });
    const session = await signInWithFirebaseToken(deps, token);
    expect(session.role).toBe("seeker");

    const { insiderProfileId, code } = await startWorkEmailOtp(deps, session.userId, "rolep1@acme.com");
    await verifyWorkEmailOtp(deps, insiderProfileId, code);

    const user = await deps.db.identity.getUserById(session.userId);
    expect(user?.role).toBe("both");
  });

  it("does not change role when verification fails", async () => {
    const { deps, issueToken, seedCompany } = makeDeps();
    seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const token = issueToken({ providerUid: "fb-rolep-2", email: "rolep2@acme.com" });
    const session = await signInWithFirebaseToken(deps, token);

    const { insiderProfileId } = await startWorkEmailOtp(deps, session.userId, "rolep2@acme.com");
    await verifyWorkEmailOtp(deps, insiderProfileId, "000000");

    const user = await deps.db.identity.getUserById(session.userId);
    expect(user?.role).toBe("seeker");
  });

  it("leaves an already-admin role unchanged", async () => {
    const { deps, seedCompany } = makeDeps();
    seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const adminUser = await deps.db.identity.findOrCreateUser("fb-rolep-3", "admin@acme.com", "admin");

    const { insiderProfileId, code } = await startWorkEmailOtp(deps, adminUser.id, "admin@acme.com");
    await verifyWorkEmailOtp(deps, insiderProfileId, code);

    const user = await deps.db.identity.getUserById(adminUser.id);
    expect(user?.role).toBe("admin");
  });
});
