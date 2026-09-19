import { describe, it, expect, beforeEach } from "vitest";
import { createFakeDatabase } from "../../adapters/db/fake";
import { post, balance, escrowFor, platformAccount, type LedgerDeps } from "./ledger";
import { LedgerImbalanceError } from "../../adapters/db/types";

describe("ledger.post", () => {
  let deps: LedgerDeps;

  beforeEach(() => {
    const { db } = createFakeDatabase();
    deps = { db };
  });

  it("posts a balanced transaction", async () => {
    const txn = await post(deps, {
      idempotencyKey: "test:1",
      eventType: "credits.purchase",
      entries: [
        { ownerType: "platform", ownerId: "platform", currency: "credits", amount: -10 },
        { ownerType: "seeker", ownerId: "seeker-1", currency: "credits", amount: 10 },
      ],
    });
    expect(txn.entries).toHaveLength(2);
    expect(await balance(deps, "seeker", "seeker-1", "credits")).toBe(10);
    expect(await balance(deps, "platform", "platform", "credits")).toBe(-10);
  });

  it("rejects an imbalanced transaction and posts nothing", async () => {
    await expect(
      post(deps, {
        idempotencyKey: "test:2",
        eventType: "credits.purchase",
        entries: [
          { ownerType: "platform", ownerId: "platform", currency: "credits", amount: -10 },
          { ownerType: "seeker", ownerId: "seeker-1", currency: "credits", amount: 5 },
        ],
      })
    ).rejects.toThrow(LedgerImbalanceError);
    expect(await balance(deps, "seeker", "seeker-1", "credits")).toBe(0);
  });

  it("rejects a transaction with no entries", async () => {
    await expect(post(deps, { idempotencyKey: "test:empty", eventType: "x", entries: [] })).rejects.toThrow();
  });

  it("validates each currency independently", async () => {
    await expect(
      post(deps, {
        idempotencyKey: "test:3",
        eventType: "request.send",
        entries: [
          { ownerType: "seeker", ownerId: "s1", currency: "credits", amount: -2 },
          { ownerType: "escrow", ownerId: "req-1", currency: "credits", amount: 2 },
          { ownerType: "platform", ownerId: "platform", currency: "points", amount: -1 },
        ],
      })
    ).rejects.toThrow(LedgerImbalanceError);
  });

  it("is idempotent on repeated idempotency key", async () => {
    const input = {
      idempotencyKey: "request:req-1:send",
      eventType: "request.send",
      entries: [
        { ownerType: "seeker" as const, ownerId: "s1", currency: "credits" as const, amount: -2 },
        { ownerType: "escrow" as const, ownerId: "req-1", currency: "credits" as const, amount: 2 },
      ],
    };
    const first = await post(deps, input);
    const second = await post(deps, input);
    expect(second.id).toBe(first.id);
    expect(await balance(deps, "escrow", "req-1", "credits")).toBe(2);
  });

  it("computes the escrow account identity from a request id", () => {
    expect(escrowFor("req-42")).toEqual({ ownerType: "escrow", ownerId: "req-42" });
  });

  it("returns 0 for an account with no postings", async () => {
    expect(await balance(deps, "insider", "unseen", "points")).toBe(0);
  });

  it("property: random balanced posting sequences always leave a global zero sum per currency", async () => {
    const owners = ["a", "b", "c", "d", "e"] as const;
    const currencies = ["credits", "points"] as const;
    let seed = 42;
    function nextRandom(): number {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    }

    for (let i = 0; i < 50; i++) {
      const currency = currencies[Math.floor(nextRandom() * currencies.length)];
      const a = owners[Math.floor(nextRandom() * owners.length)];
      let b = owners[Math.floor(nextRandom() * owners.length)];
      while (b === a) b = owners[Math.floor(nextRandom() * owners.length)];
      const amount = Math.floor(nextRandom() * 20) + 1;

      await post(deps, {
        idempotencyKey: `random:${i}`,
        eventType: "test.random",
        entries: [
          { ownerType: "platform", ownerId: a, currency, amount: -amount },
          { ownerType: "platform", ownerId: b, currency, amount },
        ],
      });

      let total = 0;
      for (const owner of owners) total += await balance(deps, "platform", owner, currency);
      expect(total).toBe(0);
    }
  });
});

describe("platformAccount", () => {
  it("returns the fixed platform owner reference", () => {
    expect(platformAccount()).toEqual({ ownerType: "platform", ownerId: "platform" });
  });
});
