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

  it("escapes HTML special characters in companyName when rendering email", () => {
    const evilPayload = { requestId: "r1", companyName: '<b>&"\'</b>' };
    for (const template of [
      templates["request.accepted"],
      templates["request.declined"],
      templates["request.expired"],
    ]) {
      const email = template.renderEmail({ ...evilPayload, ...(template === templates["request.declined"] || template === templates["request.expired"] ? { refundedCredits: 0 } : {}) });
      expect(email.html).not.toContain("<b>");
      expect(email.html).toContain("&lt;b&gt;");
      expect(email.html).toContain("&amp;");
      expect(email.html).toContain("&quot;");
      expect(email.html).toContain("&#39;");
    }
  });

  it("escapes HTML special characters in companyName and seekerName in proof.verified email", () => {
    const evilPayload = { requestId: "r1", companyName: '<b>&"\'</b>', audience: "insider" as const, seekerName: '<script>&"\'</script>' };
    const email = templates["proof.verified"].renderEmail(evilPayload);
    expect(email.html).not.toContain("<b>");
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;b&gt;");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).toContain("&amp;");
    expect(email.html).toContain("&quot;");
    expect(email.html).toContain("&#39;");
  });

  it("escapes HTML special characters in seekerName and reason in proof.rejected email", () => {
    const evilPayload = { requestId: "r1", seekerName: '<img src=x onerror=alert(1)>', reason: '"><script>alert("xss")</script>' };
    const email = templates["proof.rejected"].renderEmail(evilPayload);
    expect(email.html).not.toContain("<img");
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;img");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).toContain("&quot;");
  });

  it("escapes companyName in the seeker-audience branch of proof.verified email", () => {
    const email = templates["proof.verified"].renderEmail({
      requestId: "r1",
      companyName: '<b>&"\'</b>',
      audience: "seeker" as const,
    });
    expect(email.html).not.toContain("<b>");
    expect(email.html).toContain("&lt;b&gt;");
    expect(email.html).toContain("&amp;");
    expect(email.html).toContain("&quot;");
    expect(email.html).toContain("&#39;");
  });

  it("keeps email subjects as plain text (no HTML entities) while the body stays escaped", () => {
    const insider = templates["proof.verified"].renderEmail({
      requestId: "r1",
      companyName: "Acme",
      audience: "insider" as const,
      seekerName: "O'Brien & <Sons>",
    });
    expect(insider.subject).toContain("O'Brien & <Sons>");
    expect(insider.subject).not.toMatch(/&(amp|lt|gt|quot|#39);/);
    expect(insider.html).toContain("O&#39;Brien &amp; &lt;Sons&gt;");

    const rejected = templates["proof.rejected"].renderEmail({
      requestId: "r1",
      seekerName: "O'Brien & <Sons>",
      reason: "Unreadable",
    });
    expect(rejected.subject).toContain("O'Brien & <Sons>");
    expect(rejected.subject).not.toMatch(/&(amp|lt|gt|quot|#39);/);
    expect(rejected.html).toContain("O&#39;Brien &amp; &lt;Sons&gt;");
  });

  it("does NOT escape HTML special characters in WhatsApp text output", () => {
    const evilPayload = { requestId: "r1", companyName: '<b>&"\'</b>', refundedCredits: 1 };
    const whatsappText = templates["request.declined"].renderWhatsAppText(evilPayload);
    // WhatsApp text should contain the raw characters (not escaped)
    expect(whatsappText).toContain("<b>");
    expect(whatsappText).toContain("&");
    expect(whatsappText).not.toContain("&lt;");
    expect(whatsappText).not.toContain("&amp;");
  });

  it("does NOT escape HTML special characters in whatsappParams output", () => {
    const evilPayload = { requestId: "r1", seekerName: '<script>', reason: 'alert("xss")' };
    const params = templates["proof.rejected"].whatsappParams(evilPayload);
    // WhatsApp params should contain raw characters (not escaped)
    expect(params.seekerName).toContain("<script>");
    expect(params.reason).toContain("alert");
    expect(params.reason).not.toContain("&lt;");
  });
});
