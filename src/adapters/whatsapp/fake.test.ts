import { describe, it, expect } from "vitest";
import { createFakeWhatsAppGateway } from "./fake";

describe("createFakeWhatsAppGateway", () => {
  it("reports no active session by default, and reflects setActiveSession", async () => {
    const { gateway, setActiveSession } = createFakeWhatsAppGateway();
    expect(await gateway.hasActiveSession("user-1")).toBe(false);
    setActiveSession("user-1", true);
    expect(await gateway.hasActiveSession("user-1")).toBe(true);
    setActiveSession("user-1", false);
    expect(await gateway.hasActiveSession("user-1")).toBe(false);
  });

  it("sendSessionMessage records the message and returns a unique id, unless failure is forced", async () => {
    const { gateway, sentSessionMessages, setSessionSendFailure } = createFakeWhatsAppGateway();
    const first = await gateway.sendSessionMessage("+911234567890", "Hello");
    expect(sentSessionMessages).toEqual([{ to: "+911234567890", body: "Hello" }]);
    setSessionSendFailure("+911234567890", true);
    await expect(gateway.sendSessionMessage("+911234567890", "Hello again")).rejects.toThrow();
    setSessionSendFailure("+911234567890", false);
    const second = await gateway.sendSessionMessage("+911234567890", "Hello once more");
    expect(first.id).not.toBe(second.id);
  });

  it("sendTemplateMessage records the message and returns a unique id, unless failure is forced", async () => {
    const { gateway, sentTemplateMessages, setTemplateSendFailure } = createFakeWhatsAppGateway();
    await gateway.sendTemplateMessage("+911234567890", "request_accepted", { companyName: "Acme" });
    expect(sentTemplateMessages).toEqual([
      { to: "+911234567890", templateName: "request_accepted", params: { companyName: "Acme" } },
    ]);
    setTemplateSendFailure("+911234567890", true);
    await expect(
      gateway.sendTemplateMessage("+911234567890", "request_accepted", { companyName: "Acme" })
    ).rejects.toThrow();
  });
});
