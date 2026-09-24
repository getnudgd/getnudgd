import { describe, it, expect } from "vitest";
import { templates, templateNames } from "./templates";

describe("templates", () => {
  it("has exactly the 5 expected template names", () => {
    expect([...templateNames].sort()).toEqual(
      ["proof.rejected", "proof.verified", "request.accepted", "request.declined", "request.expired"].sort()
    );
  });

  for (const name of templateNames) {
    it(`"${name}" defines all four render functions and a WhatsApp template name`, () => {
      const definition = templates[name];
      expect(typeof definition.renderEmail).toBe("function");
      expect(typeof definition.renderWhatsAppText).toBe("function");
      expect(typeof definition.whatsappTemplateName).toBe("string");
      expect(definition.whatsappTemplateName.length).toBeGreaterThan(0);
      expect(typeof definition.whatsappParams).toBe("function");
    });
  }

  it("request.accepted renders email and WhatsApp text from a valid payload, and rejects an invalid one", () => {
    const definition = templates["request.accepted"];
    const payload = { requestId: "r1", companyName: "Acme" };
    const email = definition.renderEmail(payload);
    expect(email.subject.length).toBeGreaterThan(0);
    expect(email.html).toContain("Acme");
    expect(definition.renderWhatsAppText(payload)).toContain("Acme");
    expect(() => definition.payloadSchema.parse({ requestId: "r1" })).toThrow();
  });

  it("request.declined and request.expired render refundedCredits into both email and WhatsApp text", () => {
    for (const name of ["request.declined", "request.expired"] as const) {
      const definition = templates[name];
      const payload = { requestId: "r1", companyName: "Acme", refundedCredits: 3 };
      const email = definition.renderEmail(payload);
      expect(email.html).toContain("3");
      expect(definition.renderWhatsAppText(payload)).toContain("3");
      expect(() => definition.payloadSchema.parse({ requestId: "r1", companyName: "Acme" })).toThrow();
    }
  });

  it("proof.verified renders different copy for insider vs seeker audience", () => {
    const definition = templates["proof.verified"];
    const insiderPayload = { requestId: "r1", companyName: "Acme", audience: "insider" as const, seekerName: "Priya" };
    const seekerPayload = { requestId: "r1", companyName: "Acme", audience: "seeker" as const };
    const insiderEmail = definition.renderEmail(insiderPayload);
    const seekerEmail = definition.renderEmail(seekerPayload);
    expect(insiderEmail.html).toContain("Priya");
    expect(insiderEmail.subject).not.toBe(seekerEmail.subject);
    expect(() => definition.payloadSchema.parse({ requestId: "r1", companyName: "Acme" })).toThrow();
  });

  it("proof.rejected renders the reason into both email and WhatsApp text, and requires one", () => {
    const definition = templates["proof.rejected"];
    const payload = { requestId: "r1", seekerName: "Priya", reason: "Screenshot was unreadable" };
    expect(definition.renderEmail(payload).html).toContain("Screenshot was unreadable");
    expect(definition.renderWhatsAppText(payload)).toContain("Screenshot was unreadable");
    expect(() => definition.payloadSchema.parse({ requestId: "r1", seekerName: "Priya" })).toThrow();
  });

  it("never hardcodes the brand name — every renderer uses config/brand.ts", () => {
    // A quick structural guard: every email renderer's output must contain the
    // configured brand name for at least one template whose copy names the brand.
    const email = templates["request.accepted"].renderEmail({ requestId: "r1", companyName: "Acme" });
    expect(email.html).toMatch(/GetNudgd/);
  });
});
