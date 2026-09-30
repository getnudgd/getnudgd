import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFileMailboxEmailSender } from "./file-mailbox";

describe("createFileMailboxEmailSender", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("creates the file if it doesn't exist yet", () => {
    dir = mkdtempSync(path.join(tmpdir(), "gn-mailbox-"));
    const filePath = path.join(dir, "mailbox.jsonl");
    createFileMailboxEmailSender(filePath);
    expect(readFileSync(filePath, "utf8")).toBe("");
  });

  it("appends each sent message as a JSON line with to/subject/html/sentAt", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "gn-mailbox-"));
    const filePath = path.join(dir, "mailbox.jsonl");
    const { sender } = createFileMailboxEmailSender(filePath);

    await sender.send({ to: "a@b.com", subject: "Hi", html: "<p>Code: 123456</p>" });
    await sender.send({ to: "c@d.com", subject: "Hi 2", html: "<p>Code: 654321</p>" });

    const lines = readFileSync(filePath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]);
    expect(first).toMatchObject({ to: "a@b.com", subject: "Hi", html: "<p>Code: 123456</p>" });
    expect(typeof first.sentAt).toBe("string");
  });

  it("never logs the message to the console", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "gn-mailbox-"));
    const filePath = path.join(dir, "mailbox.jsonl");
    const { sender } = createFileMailboxEmailSender(filePath);
    const logSpy = vi.spyOn(console, "log");
    await sender.send({ to: "a@b.com", subject: "Hi", html: "<p>Code: 123456</p>" });
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });
});
