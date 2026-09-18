import { describe, it, expect } from "vitest";
import { createFakeEmailSender } from "./fake";

describe("createFakeEmailSender", () => {
  it("records sent messages and returns a unique id per send", async () => {
    const { sender, sent } = createFakeEmailSender();
    const first = await sender.send({ to: "a@b.com", subject: "Hi", html: "<p>Hi</p>" });
    const second = await sender.send({ to: "c@d.com", subject: "Hi again", html: "<p>Hi</p>" });
    expect(sent).toHaveLength(2);
    expect(first.id).not.toBe(second.id);
  });
});
