import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDatabase } from "@/src/adapters/db/fake";
import { createFakeEmailSender } from "@/src/adapters/email/fake";
import type { Database } from "@/src/adapters/db/types";
import type { EmailSender, EmailMessage } from "@/src/adapters/email/types";

const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});
vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
}));

let currentIp = "10.1.0.1";
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": currentIp }),
}));

const getCurrentUserMock = vi.fn();
vi.mock("@/src/lib/current-user", () => ({
  getCurrentUser: () => getCurrentUserMock(),
}));

// getAdapters() is mocked directly (rather than driven through real env/ADAPTERS
// bootstrapping) so each test can reach the fake db's seedCompany() helper —
// seedCompany only exists on createFakeDatabase()'s own return value, not on the
// Database interface getAdapters() normally exposes.
let testDb: Database;
let testEmailSender: EmailSender;
vi.mock("@/src/lib/adapters", () => ({
  getAdapters: () => ({ db: testDb, email: testEmailSender }),
}));

import {
  createSeekerProfileAction,
  requestInsiderOtpAction,
  resendInsiderOtpAction,
  verifyInsiderOtpAction,
} from "./actions";

describe("onboard actions", () => {
  let seedCompany: ReturnType<typeof createFakeDatabase>["seedCompany"];
  let emailSent: EmailMessage[];
  let ipCounter = 0;

  beforeEach(() => {
    const fakeDb = createFakeDatabase();
    testDb = fakeDb.db;
    seedCompany = fakeDb.seedCompany;
    const fakeEmail = createFakeEmailSender();
    testEmailSender = fakeEmail.sender;
    emailSent = fakeEmail.sent;

    redirectMock.mockClear();
    getCurrentUserMock.mockReset();
    ipCounter++;
    currentIp = `10.1.0.${ipCounter}`; // unique per test — otpSendLimiter/otpVerifyLimiter are keyed by userId+IP
  });

  describe("createSeekerProfileAction", () => {
    it("returns a problem when there is no session", async () => {
      getCurrentUserMock.mockResolvedValue(null);
      const result = await createSeekerProfileAction({ fullName: "Priya" });
      expect(result).toEqual({ ok: false, problem: expect.objectContaining({ type: "auth-invalid-token" }) });
    });

    it("creates the profile and redirects to /seeker/dashboard", async () => {
      const user = await testDb.identity.findOrCreateUser("fb-onb-seeker-1", "s1@x.com", "seeker");
      getCurrentUserMock.mockResolvedValue({ userId: user.id, role: "seeker", seekerProfileId: null, insiderProfile: null });

      await expect(createSeekerProfileAction({ fullName: "Priya" })).rejects.toThrow("REDIRECT:/seeker/dashboard");
      expect((await testDb.identity.getSeekerProfileByUserId(user.id))?.fullName).toBe("Priya");
    });

    it("rejects an empty full name", async () => {
      const user = await testDb.identity.findOrCreateUser("fb-onb-seeker-2", "s2@x.com", "seeker");
      getCurrentUserMock.mockResolvedValue({ userId: user.id, role: "seeker", seekerProfileId: null, insiderProfile: null });

      const result = await createSeekerProfileAction({ fullName: "" });
      expect(result).toEqual({ ok: false, problem: expect.objectContaining({ type: "validation-failed" }) });
    });
  });

  describe("requestInsiderOtpAction", () => {
    it("returns a problem when there is no session", async () => {
      getCurrentUserMock.mockResolvedValue(null);
      const result = await requestInsiderOtpAction({ fullName: "Rahul", workEmail: "r@acme.com" });
      expect(result).toEqual({ ok: false, problem: expect.objectContaining({ type: "auth-invalid-token" }) });
    });

    it("sends the OTP and returns ok for a registered domain", async () => {
      seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
      const user = await testDb.identity.findOrCreateUser("fb-onb-ins-1", "i1@x.com", "seeker");
      getCurrentUserMock.mockResolvedValue({ userId: user.id, role: "seeker", seekerProfileId: null, insiderProfile: null });

      const result = await requestInsiderOtpAction({ fullName: "Rahul", workEmail: "r1@acme.com" });
      expect(result).toEqual({ ok: true });
    });

    it("maps an unregistered domain to a problem instead of throwing to the caller", async () => {
      const user = await testDb.identity.findOrCreateUser("fb-onb-ins-2", "i2@x.com", "seeker");
      getCurrentUserMock.mockResolvedValue({ userId: user.id, role: "seeker", seekerProfileId: null, insiderProfile: null });

      const result = await requestInsiderOtpAction({ fullName: "Rahul", workEmail: "r2@unknown-domain.com" });
      expect(result).toEqual({ ok: false, problem: expect.objectContaining({ type: "work-email-domain-not-registered" }) });
    });

    it("denies after the send rate limit is exceeded", async () => {
      seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
      const user = await testDb.identity.findOrCreateUser("fb-onb-ins-3", "i3@x.com", "seeker");
      getCurrentUserMock.mockResolvedValue({ userId: user.id, role: "seeker", seekerProfileId: null, insiderProfile: null });

      for (let i = 0; i < 3; i++) {
        const r = await requestInsiderOtpAction({ fullName: "Rahul", workEmail: "r3@acme.com" });
        expect(r).toEqual({ ok: true });
      }
      const fourth = await requestInsiderOtpAction({ fullName: "Rahul", workEmail: "r3@acme.com" });
      expect(fourth).toEqual({ ok: false, problem: expect.objectContaining({ type: "rate-limited" }) });
    });
  });

  describe("verifyInsiderOtpAction", () => {
    it("returns a problem for a wrong code", async () => {
      seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
      const user = await testDb.identity.findOrCreateUser("fb-onb-verify-1", "v1@x.com", "seeker");
      getCurrentUserMock.mockResolvedValue({ userId: user.id, role: "seeker", seekerProfileId: null, insiderProfile: null });
      await requestInsiderOtpAction({ fullName: "Rahul", workEmail: "v1@acme.com" });

      const result = await verifyInsiderOtpAction({ code: "111111" });
      expect(result).toEqual({ ok: false, problem: expect.objectContaining({ type: "otp-invalid-or-expired" }) });
    });

    it("redirects to /insider/dashboard on a correct code", async () => {
      seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
      const user = await testDb.identity.findOrCreateUser("fb-onb-verify-2", "v2@x.com", "seeker");
      getCurrentUserMock.mockResolvedValue({ userId: user.id, role: "seeker", seekerProfileId: null, insiderProfile: null });

      await requestInsiderOtpAction({ fullName: "Rahul", workEmail: "v2@acme.com" });
      const code = emailSent[emailSent.length - 1]?.html.match(/\d{6}/)?.[0];

      await expect(verifyInsiderOtpAction({ code: code! })).rejects.toThrow("REDIRECT:/insider/dashboard");
    });

    it("redirects a both-role user (a Seeker who just verified as Insider) to /insider/dashboard, not /seeker/dashboard — resolveLanding would pick /seeker/dashboard here, which is why the redirect target is fixed rather than resolveLanding-derived", async () => {
      seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
      const user = await testDb.identity.findOrCreateUser("fb-onb-verify-3", "v3@x.com", "seeker");
      const { record: seekerProfile } = await testDb.identity.createOrGetSeekerProfile(user.id, "Already A Seeker");
      getCurrentUserMock.mockResolvedValue({
        userId: user.id,
        role: "both",
        seekerProfileId: seekerProfile.id,
        insiderProfile: null,
      });

      await requestInsiderOtpAction({ fullName: "Rahul", workEmail: "v3@acme.com" });
      const code = emailSent[emailSent.length - 1]?.html.match(/\d{6}/)?.[0];

      await expect(verifyInsiderOtpAction({ code: code! })).rejects.toThrow("REDIRECT:/insider/dashboard");
    });
  });

  describe("resendInsiderOtpAction", () => {
    it("returns a problem when there is no session", async () => {
      getCurrentUserMock.mockResolvedValue(null);
      const result = await resendInsiderOtpAction();
      expect(result).toEqual({ ok: false, problem: expect.objectContaining({ type: "auth-invalid-token" }) });
    });

    it("resends to the already-stored work email, with no form fields to re-supply — the resumed-OTP-step scenario (spec §4.9 row 1, a page reload mid-flow)", async () => {
      seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
      const user = await testDb.identity.findOrCreateUser("fb-onb-resend-1", "rs1@x.com", "seeker");
      getCurrentUserMock.mockResolvedValue({ userId: user.id, role: "seeker", seekerProfileId: null, insiderProfile: null });

      await requestInsiderOtpAction({ fullName: "Rahul", workEmail: "rs1@acme.com" });
      const result = await resendInsiderOtpAction();

      expect(result).toEqual({ ok: true });
      expect(emailSent).toHaveLength(2);
      expect(emailSent[1].to).toBe("rs1@acme.com");
    });

    it("denies after the send rate limit is exceeded, sharing the same bucket as requestInsiderOtpAction", async () => {
      seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
      const user = await testDb.identity.findOrCreateUser("fb-onb-resend-2", "rs2@x.com", "seeker");
      getCurrentUserMock.mockResolvedValue({ userId: user.id, role: "seeker", seekerProfileId: null, insiderProfile: null });

      await requestInsiderOtpAction({ fullName: "Rahul", workEmail: "rs2@acme.com" });
      await resendInsiderOtpAction();
      await resendInsiderOtpAction();
      const fourth = await resendInsiderOtpAction();
      expect(fourth).toEqual({ ok: false, problem: expect.objectContaining({ type: "rate-limited" }) });
    });
  });
});
