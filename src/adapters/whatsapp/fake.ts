import type { WhatsAppGateway } from "./types";

export interface FakeWhatsAppGateway {
  gateway: WhatsAppGateway;
  setActiveSession(userId: string, active: boolean): void;
  setSessionSendFailure(phone: string, shouldFail: boolean): void;
  setTemplateSendFailure(phone: string, shouldFail: boolean): void;
  sentSessionMessages: Array<{ to: string; body: string }>;
  sentTemplateMessages: Array<{ to: string; templateName: string; params: Record<string, string> }>;
}

export function createFakeWhatsAppGateway(): FakeWhatsAppGateway {
  const activeSessions = new Set<string>();
  const sessionFailures = new Set<string>();
  const templateFailures = new Set<string>();
  const sentSessionMessages: Array<{ to: string; body: string }> = [];
  const sentTemplateMessages: Array<{ to: string; templateName: string; params: Record<string, string> }> = [];

  const gateway: WhatsAppGateway = {
    async hasActiveSession(userId) {
      return activeSessions.has(userId);
    },
    async sendSessionMessage(to, body) {
      if (sessionFailures.has(to)) throw new Error(`Fake WhatsApp session send failed for ${to}`);
      sentSessionMessages.push({ to, body });
      return { id: `fake-wa-session-${sentSessionMessages.length}` };
    },
    async sendTemplateMessage(to, templateName, params) {
      if (templateFailures.has(to)) throw new Error(`Fake WhatsApp template send failed for ${to}`);
      sentTemplateMessages.push({ to, templateName, params });
      return { id: `fake-wa-template-${sentTemplateMessages.length}` };
    },
  };

  return {
    gateway,
    setActiveSession(userId, active) {
      if (active) activeSessions.add(userId);
      else activeSessions.delete(userId);
    },
    setSessionSendFailure(phone, shouldFail) {
      if (shouldFail) sessionFailures.add(phone);
      else sessionFailures.delete(phone);
    },
    setTemplateSendFailure(phone, shouldFail) {
      if (shouldFail) templateFailures.add(phone);
      else templateFailures.delete(phone);
    },
    sentSessionMessages,
    sentTemplateMessages,
  };
}
