import type { EmailSender, EmailMessage } from "./types";

export function createFakeEmailSender(): { sender: EmailSender; sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  const sender: EmailSender = {
    async send(message) {
      sent.push(message);
      return { id: `fake-email-${sent.length}` };
    },
  };
  return { sender, sent };
}
