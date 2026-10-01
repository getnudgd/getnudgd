import { describe, it, expect } from "vitest";
import { resolveStartingStep } from "./step";

const noProfiles = { seekerProfileId: null, insiderProfile: null };

describe("resolveStartingStep", () => {
  it("row 1: resumes OTP entry for an unverified Insider profile, regardless of add or Seeker profile", () => {
    const user = { seekerProfileId: "sp1", insiderProfile: { verifiedAt: null } };
    expect(resolveStartingStep(user, undefined)).toBe("otp");
    expect(resolveStartingStep(user, "seeker")).toBe("otp");
  });

  it("row 2: add=seeker starts the Seeker-name step when no Seeker profile exists", () => {
    expect(resolveStartingStep(noProfiles, "seeker")).toBe("seeker-name");
  });

  it("row 2 does not fire when a Seeker profile already exists", () => {
    const user = { seekerProfileId: "sp1", insiderProfile: null };
    expect(resolveStartingStep(user, "seeker")).not.toBe("seeker-name");
  });

  it("row 3: add=insider starts the Insider name+email step when no Insider profile exists", () => {
    expect(resolveStartingStep(noProfiles, "insider")).toBe("insider-name-email");
  });

  it("row 4: no profiles and no add param shows the role-choice step", () => {
    expect(resolveStartingStep(noProfiles, undefined)).toBe("role-choice");
  });

  it("row 5: a Seeker profile with no add param, and no unverified Insider profile, resolves to null (redirect away)", () => {
    const user = { seekerProfileId: "sp1", insiderProfile: null };
    expect(resolveStartingStep(user, undefined)).toBeNull();
  });

  it("row 5: a verified Insider profile with no Seeker profile and no add param resolves to null (redirect away)", () => {
    const user = { seekerProfileId: null, insiderProfile: { verifiedAt: new Date() } };
    expect(resolveStartingStep(user, undefined)).toBeNull();
  });

  it("row 1 wins over row 5 even for a fully-onboarded-by-resolveLanding user: a Seeker profile plus an unverified Insider profile still resumes OTP, not a redirect away", () => {
    const user = { seekerProfileId: "sp1", insiderProfile: { verifiedAt: null } };
    expect(resolveStartingStep(user, undefined)).toBe("otp");
  });
});
