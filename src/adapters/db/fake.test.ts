import { describe, it, expect } from "vitest";
import { createFakeDatabase } from "./fake";
import { LedgerImbalanceError } from "./types";

describe("createFakeDatabase ledger", () => {
  it("posts a balanced transaction and reflects it in balances", async () => {
    const { db } = createFakeDatabase();
    await db.ledger.postTxn({
      idempotencyKey: "t1",
      eventType: "test",
      entries: [
        { ownerType: "platform", ownerId: "platform", currency: "credits", amount: -5 },
        { ownerType: "seeker", ownerId: "s1", currency: "credits", amount: 5 },
      ],
    });
    expect(await db.ledger.getBalance("seeker", "s1", "credits")).toBe(5);
  });

  it("rejects an imbalanced transaction", async () => {
    const { db } = createFakeDatabase();
    await expect(
      db.ledger.postTxn({
        idempotencyKey: "t2",
        eventType: "test",
        entries: [{ ownerType: "seeker", ownerId: "s1", currency: "credits", amount: 5 }],
      })
    ).rejects.toThrow(LedgerImbalanceError);
  });

  it("is idempotent on repeated idempotency key", async () => {
    const { db } = createFakeDatabase();
    const input = {
      idempotencyKey: "t3",
      eventType: "test",
      entries: [
        { ownerType: "platform" as const, ownerId: "platform", currency: "credits" as const, amount: -1 },
        { ownerType: "seeker" as const, ownerId: "s1", currency: "credits" as const, amount: 1 },
      ],
    };
    const first = await db.ledger.postTxn(input);
    const second = await db.ledger.postTxn(input);
    expect(second.id).toBe(first.id);
    expect(await db.ledger.getBalance("seeker", "s1", "credits")).toBe(1);
  });

  it("returns null for an account that was never posted to", async () => {
    const { db } = createFakeDatabase();
    expect(await db.ledger.findAccount("insider", "unknown", "points")).toBeNull();
  });
});

describe("createFakeDatabase config", () => {
  it("returns null when a key has no rows", async () => {
    const { db } = createFakeDatabase();
    expect(await db.config.getLatest("rules")).toBeNull();
  });

  it("seedConfig makes a row visible via getLatest and getVersion", async () => {
    const { db, seedConfig } = createFakeDatabase();
    seedConfig({ key: "rules", version: 1, value: { a: 1 }, placeholder: true });
    seedConfig({ key: "rules", version: 2, value: { a: 2 }, placeholder: true });
    expect((await db.config.getLatest("rules"))?.version).toBe(2);
    expect((await db.config.getVersion("rules", 1))?.value).toEqual({ a: 1 });
  });
});
