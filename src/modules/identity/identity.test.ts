import { describe, it, expect, vi } from "vitest";
import { createFakeDatabase } from "../../adapters/db/fake";
import { createFakeAuthAdapter } from "../../adapters/auth/fake";
import { createFakeEmailSender } from "../../adapters/email/fake";
import {
  signInWithFirebaseToken,
  startWorkEmailOtp,
  verifyWorkEmailOtp,
  promoteRoleForInsiderVerification,
  WorkEmailDomainError,
  InsiderCompanyChangeError,
  getCurrentUserFromDb,
  resolveLanding,
  canAccessAdmin,
  canAccessSeekerApp,
  canAccessInsiderApp,
  createOrGetSeekerProfile,
  requestWorkEmailOtp,
  resendWorkEmailOtp,
  verifyWorkEmailOtpForUser,
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

describe("startWorkEmailOtp company-change handling", () => {
  it("updates an unverified profile's company when called again with a different company", async () => {
    const { deps, issueToken, seedCompany } = makeDeps();
    seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const beta = seedCompany({ name: "Beta", tier: "tier2" }, ["beta.com"]);
    const token = issueToken({ providerUid: "fb-cc-1", email: "cc1@example.com" });
    const session = await signInWithFirebaseToken(deps, token);

    const first = await startWorkEmailOtp(deps, session.userId, "person@acme.com");
    const second = await startWorkEmailOtp(deps, session.userId, "person@beta.com");

    expect(second.insiderProfileId).toBe(first.insiderProfileId);
    const profile = await deps.db.identity.getInsiderProfileById(second.insiderProfileId);
    expect(profile?.companyId).toBe(beta.id);
    expect(profile?.workEmail).toBe("person@beta.com");
  });

  it("verifies against the updated company after a company change", async () => {
    const { deps, issueToken, seedCompany } = makeDeps();
    seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const beta = seedCompany({ name: "Beta", tier: "tier2" }, ["beta.com"]);
    const token = issueToken({ providerUid: "fb-cc-2", email: "cc2@example.com" });
    const session = await signInWithFirebaseToken(deps, token);

    await startWorkEmailOtp(deps, session.userId, "person@acme.com");
    const { insiderProfileId, code } = await startWorkEmailOtp(deps, session.userId, "person@beta.com");
    await verifyWorkEmailOtp(deps, insiderProfileId, code);

    const profile = await deps.db.identity.getInsiderProfileById(insiderProfileId);
    expect(profile?.companyId).toBe(beta.id);
    expect(profile?.verifiedAt).not.toBeNull();
  });

  it("throws when trying to change company for an already-verified insider", async () => {
    const { deps, issueToken, seedCompany } = makeDeps();
    seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    seedCompany({ name: "Beta", tier: "tier2" }, ["beta.com"]);
    const token = issueToken({ providerUid: "fb-cc-3", email: "cc3@example.com" });
    const session = await signInWithFirebaseToken(deps, token);

    const { insiderProfileId, code } = await startWorkEmailOtp(deps, session.userId, "person@acme.com");
    await verifyWorkEmailOtp(deps, insiderProfileId, code);

    await expect(startWorkEmailOtp(deps, session.userId, "person@beta.com")).rejects.toThrow(InsiderCompanyChangeError);
  });
});

describe("getCurrentUserFromDb", () => {
  it("returns null when the user doesn't exist", async () => {
    const { deps } = makeDeps();
    expect(await getCurrentUserFromDb(deps, "nonexistent")).toBeNull();
  });

  it("returns a CurrentUser with null profiles for a brand-new user", async () => {
    const { deps } = makeDeps();
    const user = await deps.db.identity.findOrCreateUser("fb-cu-1", "cu1@x.com", "seeker");
    expect(await getCurrentUserFromDb(deps, user.id)).toEqual({
      userId: user.id,
      role: "seeker",
      seekerProfileId: null,
      insiderProfile: null,
    });
  });

  it("includes the seeker profile id once one exists", async () => {
    const { deps } = makeDeps();
    const user = await deps.db.identity.findOrCreateUser("fb-cu-2", "cu2@x.com", "seeker");
    const { record } = await deps.db.identity.createOrGetSeekerProfile(user.id, "CU Two");
    const currentUser = await getCurrentUserFromDb(deps, user.id);
    expect(currentUser?.seekerProfileId).toBe(record.id);
  });

  it("includes the insider profile with verifiedAt once one exists", async () => {
    const { deps, seedCompany } = makeDeps();
    const company = seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const user = await deps.db.identity.findOrCreateUser("fb-cu-3", "cu3@acme.com", "seeker");
    const profile = await deps.db.identity.findOrCreateInsiderProfile(user.id, company.id, "cu3@acme.com");
    const currentUser = await getCurrentUserFromDb(deps, user.id);
    expect(currentUser?.insiderProfile).toEqual({ id: profile.id, verifiedAt: null });
  });
});

describe("resolveLanding", () => {
  const base = { userId: "u1", seekerProfileId: null, insiderProfile: null } as const;

  it("sends an admin to /admin regardless of profiles", () => {
    expect(resolveLanding({ ...base, role: "admin", seekerProfileId: "sp1" })).toBe("/admin");
  });

  it("sends a user with a Seeker profile to /seeker/dashboard", () => {
    expect(resolveLanding({ ...base, role: "seeker", seekerProfileId: "sp1" })).toBe("/seeker/dashboard");
  });

  it("sends a both-role user with a Seeker profile AND a verified Insider profile to /seeker/dashboard, not /insider/dashboard", () => {
    expect(
      resolveLanding({
        ...base,
        role: "both",
        seekerProfileId: "sp1",
        insiderProfile: { id: "ip1", verifiedAt: new Date() },
      })
    ).toBe("/seeker/dashboard");
  });

  it("sends a verified Insider with no Seeker profile to /insider/dashboard", () => {
    expect(
      resolveLanding({ ...base, role: "insider", insiderProfile: { id: "ip1", verifiedAt: new Date() } })
    ).toBe("/insider/dashboard");
  });

  it("sends an unverified Insider with no Seeker profile to /onboard", () => {
    expect(resolveLanding({ ...base, role: "insider", insiderProfile: { id: "ip1", verifiedAt: null } })).toBe(
      "/onboard"
    );
  });

  it("sends a user with no profiles at all to /onboard", () => {
    expect(resolveLanding({ ...base, role: "seeker" })).toBe("/onboard");
  });

  it("never traps a Seeker who abandoned adding the Insider role: a Seeker profile plus an unverified Insider profile still lands on /seeker/dashboard", () => {
    expect(
      resolveLanding({
        ...base,
        role: "both",
        seekerProfileId: "sp1",
        insiderProfile: { id: "ip1", verifiedAt: null },
      })
    ).toBe("/seeker/dashboard");
  });
});

describe("canAccessAdmin / canAccessSeekerApp / canAccessInsiderApp", () => {
  const base = { userId: "u1", seekerProfileId: null, insiderProfile: null } as const;

  it("canAccessAdmin is true only for role=admin", () => {
    expect(canAccessAdmin({ ...base, role: "admin" })).toBe(true);
    expect(canAccessAdmin({ ...base, role: "both" })).toBe(false);
    expect(canAccessAdmin({ ...base, role: "seeker" })).toBe(false);
  });

  it("canAccessSeekerApp is true iff a Seeker profile exists, regardless of role", () => {
    expect(canAccessSeekerApp({ ...base, role: "seeker", seekerProfileId: "sp1" })).toBe(true);
    expect(canAccessSeekerApp({ ...base, role: "both", seekerProfileId: "sp1" })).toBe(true);
    expect(canAccessSeekerApp({ ...base, role: "seeker" })).toBe(false);
    expect(canAccessSeekerApp({ ...base, role: "admin" })).toBe(false);
  });

  it("canAccessInsiderApp is true iff an Insider profile exists AND is verified", () => {
    expect(canAccessInsiderApp({ ...base, role: "insider", insiderProfile: { id: "ip1", verifiedAt: new Date() } })).toBe(
      true
    );
    expect(canAccessInsiderApp({ ...base, role: "insider", insiderProfile: { id: "ip1", verifiedAt: null } })).toBe(
      false
    );
    expect(canAccessInsiderApp({ ...base, role: "insider" })).toBe(false);
  });
});

describe("createOrGetSeekerProfile (module wrapper)", () => {
  it("creates a profile and returns the same one on repeated calls", async () => {
    const { deps } = makeDeps();
    const user = await deps.db.identity.findOrCreateUser("fb-cogsp-1", "cogsp1@x.com", "seeker");
    const first = await createOrGetSeekerProfile(deps, user.id, "First Name");
    const second = await createOrGetSeekerProfile(deps, user.id, "Second Name");
    expect(second.id).toBe(first.id);
    expect(second.fullName).toBe("First Name");
  });
});

describe("requestWorkEmailOtp", () => {
  it("sends an email containing a 6-digit code and the brand name in the subject", async () => {
    const { deps, seedCompany } = makeDeps();
    seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const { sender, sent } = createFakeEmailSender();

    await requestWorkEmailOtp({ db: deps.db, email: sender }, "user-1", "person@acme.com");

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("person@acme.com");
    expect(sent[0].subject).toContain("GetNudgd");
    expect(sent[0].html).toMatch(/\d{6}/);
  });

  it("never returns the code itself, only the insiderProfileId", async () => {
    const { deps, seedCompany } = makeDeps();
    seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const { sender } = createFakeEmailSender();

    const result = await requestWorkEmailOtp({ db: deps.db, email: sender }, "user-1", "person@acme.com");
    expect(Object.keys(result)).toEqual(["insiderProfileId"]);
  });

  it("invalidates the first email's OTP when called again with a different work email", async () => {
    const { deps, seedCompany } = makeDeps();
    seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    seedCompany({ name: "Beta", tier: "tier2" }, ["beta.com"]);
    const { sender, sent } = createFakeEmailSender();

    await requestWorkEmailOtp({ db: deps.db, email: sender }, "user-1", "person@acme.com");
    const firstCode = sent[0].html.match(/\d{6}/)?.[0];
    await requestWorkEmailOtp({ db: deps.db, email: sender }, "user-1", "person@beta.com");
    const secondCode = sent[1].html.match(/\d{6}/)?.[0];

    expect(await verifyWorkEmailOtpForUser({ db: deps.db }, "user-1", firstCode!)).toBe(false);
    expect(await verifyWorkEmailOtpForUser({ db: deps.db }, "user-1", secondCode!)).toBe(true);
  });
});

describe("resendWorkEmailOtp", () => {
  it("resends to the Insider profile's already-stored work email, without the caller supplying it again", async () => {
    const { deps, seedCompany } = makeDeps();
    seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const { sender, sent } = createFakeEmailSender();

    await requestWorkEmailOtp({ db: deps.db, email: sender }, "user-1", "person@acme.com");
    const result = await resendWorkEmailOtp({ db: deps.db, email: sender }, "user-1");

    expect(result?.insiderProfileId).toBeTruthy();
    expect(sent).toHaveLength(2);
    expect(sent[1].to).toBe("person@acme.com");
  });

  it("invalidates the previous code on resend", async () => {
    const { deps, seedCompany } = makeDeps();
    seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const { sender, sent } = createFakeEmailSender();

    await requestWorkEmailOtp({ db: deps.db, email: sender }, "user-1", "person@acme.com");
    const firstCode = sent[0].html.match(/\d{6}/)![0];
    await resendWorkEmailOtp({ db: deps.db, email: sender }, "user-1");
    const secondCode = sent[1].html.match(/\d{6}/)![0];

    expect(await verifyWorkEmailOtpForUser({ db: deps.db }, "user-1", firstCode)).toBe(false);
    expect(await verifyWorkEmailOtpForUser({ db: deps.db }, "user-1", secondCode)).toBe(true);
  });

  it("returns null when the user has no Insider profile at all", async () => {
    const { deps } = makeDeps();
    const { sender } = createFakeEmailSender();
    expect(await resendWorkEmailOtp({ db: deps.db, email: sender }, "user-with-no-profile")).toBeNull();
  });
});

describe("verifyWorkEmailOtpForUser", () => {
  it("verifies using the caller's own userId, never a caller-supplied profile id", async () => {
    const { deps, seedCompany } = makeDeps();
    seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const { sender, sent } = createFakeEmailSender();

    await requestWorkEmailOtp({ db: deps.db, email: sender }, "user-1", "person@acme.com");
    const code = sent[0].html.match(/\d{6}/)![0];

    expect(await verifyWorkEmailOtpForUser({ db: deps.db }, "user-1", code)).toBe(true);
  });

  it("returns false when the user has no Insider profile at all", async () => {
    const { deps } = makeDeps();
    expect(await verifyWorkEmailOtpForUser({ db: deps.db }, "user-with-no-profile", "000000")).toBe(false);
  });

  it("returns false for a wrong code", async () => {
    const { deps, seedCompany } = makeDeps();
    seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const { sender } = createFakeEmailSender();

    await requestWorkEmailOtp({ db: deps.db, email: sender }, "user-1", "person@acme.com");
    expect(await verifyWorkEmailOtpForUser({ db: deps.db }, "user-1", "000000")).toBe(false);
  });
});
