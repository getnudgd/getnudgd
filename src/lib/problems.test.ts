import { describe, it, expect } from "vitest";
import { z, ZodError } from "zod";
import { problem, mapErrorToProblem } from "./problems";
import { WorkEmailDomainError, InsiderCompanyChangeError } from "../modules/identity/identity";
import { InvalidTokenError } from "../adapters/auth/types";

describe("problem", () => {
  it("returns the type with a non-empty human title, for every ProblemType", () => {
    const types = [
      "work-email-domain-not-registered",
      "insider-company-change-not-allowed",
      "otp-invalid-or-expired",
      "auth-invalid-token",
      "dev-login-wrong-code",
      "rate-limited",
      "validation-failed",
      "unexpected",
    ] as const;
    for (const type of types) {
      const p = problem(type);
      expect(p.type).toBe(type);
      expect(p.title.length).toBeGreaterThan(0);
    }
  });
});

describe("mapErrorToProblem", () => {
  it("maps a ZodError to validation-failed", () => {
    let caught: unknown;
    try {
      z.object({ x: z.string() }).parse({});
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ZodError);
    expect(mapErrorToProblem(caught).type).toBe("validation-failed");
  });

  it("maps WorkEmailDomainError to work-email-domain-not-registered", () => {
    expect(mapErrorToProblem(new WorkEmailDomainError("nope.com")).type).toBe("work-email-domain-not-registered");
  });

  it("maps InsiderCompanyChangeError to insider-company-change-not-allowed", () => {
    expect(mapErrorToProblem(new InsiderCompanyChangeError()).type).toBe("insider-company-change-not-allowed");
  });

  it("maps InvalidTokenError to auth-invalid-token", () => {
    expect(mapErrorToProblem(new InvalidTokenError()).type).toBe("auth-invalid-token");
  });

  it("falls back to unexpected for an unrecognized Error", () => {
    expect(mapErrorToProblem(new Error("boom")).type).toBe("unexpected");
  });

  it("falls back to unexpected for a non-Error thrown string", () => {
    expect(mapErrorToProblem("boom").type).toBe("unexpected");
  });

  it("falls back to unexpected for a non-Error object with a message field, without throwing", () => {
    expect(() => mapErrorToProblem({ message: "looks like an error but isn't" })).not.toThrow();
    expect(mapErrorToProblem({ message: "looks like an error but isn't" }).type).toBe("unexpected");
  });

  it("never renders a thrown error's own .message as the title", () => {
    const p = mapErrorToProblem(new Error("some vendor-internal stack trace detail"));
    expect(p.title).not.toContain("vendor-internal stack trace detail");
  });
});
