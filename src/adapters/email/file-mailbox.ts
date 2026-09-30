import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { createFakeEmailSender } from "./fake";
import type { EmailSender } from "./types";

/**
 * Wraps createFakeEmailSender: same in-memory behavior, plus every sent
 * message is appended to filePath as one JSON line, for a separate process
 * (Playwright) to read. Never logged to the console — OTP codes are
 * secret-shaped data.
 */
export function createFileMailboxEmailSender(filePath: string): { sender: EmailSender } {
  const { sender: fakeSender } = createFakeEmailSender();
  if (!existsSync(filePath)) writeFileSync(filePath, "");

  const sender: EmailSender = {
    async send(message) {
      const result = await fakeSender.send(message);
      const line = JSON.stringify({ ...message, sentAt: new Date().toISOString() });
      appendFileSync(filePath, line + "\n");
      return result;
    },
  };
  return { sender };
}
