import { describe, it, expect } from "vitest";
import { createFakeDatabase } from "../../adapters/db/fake";
import { getRules, getPacks, getRulesWithVersion, ConfigNotFoundError } from "./config";

const RULES_V1 = {
  key: "rules",
  version: 1,
  placeholder: true,
  value: {
    responseWindowHours: 48,
    interviewWindowDays: 14,
    reverificationDays: 90,
    tranche1Percent: 50,
    tranche2Percent: 50,
    refundPercentOnDecline: 100,
    refundPercentOnExpiry: 100,
    minRedemptionPoints: 500,
    panThresholdPoints: 5000,
    freeCreditGrant: 3,
    requestCostByTier: { tier1: 3, tier2: 2, tier3: 1 },
  },
};

describe("config.getRules", () => {
  it("returns the latest rules version", async () => {
    const { db, seedConfig } = createFakeDatabase();
    seedConfig(RULES_V1);
    const rules = await getRules({ db });
    expect(rules.responseWindowHours).toBe(48);
  });

  it("returns a specific version when requested", async () => {
    const { db, seedConfig } = createFakeDatabase();
    seedConfig(RULES_V1);
    seedConfig({ ...RULES_V1, version: 2, value: { ...RULES_V1.value, responseWindowHours: 72 } });
    const v1 = await getRules({ db }, 1);
    expect(v1.responseWindowHours).toBe(48);
  });

  it("throws ConfigNotFoundError when no rules exist", async () => {
    const { db } = createFakeDatabase();
    await expect(getRules({ db })).rejects.toThrow(ConfigNotFoundError);
  });

  it("throws when the stored shape is invalid", async () => {
    const { db, seedConfig } = createFakeDatabase();
    seedConfig({ key: "rules", version: 1, placeholder: true, value: { nonsense: true } });
    await expect(getRules({ db })).rejects.toThrow();
  });
});

describe("config.getPacks", () => {
  it("returns parsed credit packs", async () => {
    const { db, seedConfig } = createFakeDatabase();
    seedConfig({
      key: "credit_packs",
      version: 1,
      placeholder: true,
      value: [{ id: "starter", credits: 5, priceInPaise: 19900 }],
    });
    const packs = await getPacks({ db });
    expect(packs).toHaveLength(1);
    expect(packs[0].credits).toBe(5);
  });

  it("throws ConfigNotFoundError when no packs exist", async () => {
    const { db } = createFakeDatabase();
    await expect(getPacks({ db })).rejects.toThrow(ConfigNotFoundError);
  });
});

describe("getRulesWithVersion", () => {
  it("returns both the parsed rules and the version they came from", async () => {
    const { db, seedConfig } = createFakeDatabase();
    seedConfig({
      key: "rules",
      version: 3,
      placeholder: true,
      value: {
        responseWindowHours: 48,
        interviewWindowDays: 14,
        reverificationDays: 90,
        tranche1Percent: 50,
        tranche2Percent: 50,
        refundPercentOnDecline: 100,
        refundPercentOnExpiry: 100,
        minRedemptionPoints: 500,
        panThresholdPoints: 5000,
        freeCreditGrant: 3,
        requestCostByTier: { tier1: 3, tier2: 2, tier3: 1 },
      },
    });

    const result = await getRulesWithVersion({ db });
    expect(result.version).toBe(3);
    expect(result.rules.requestCostByTier.tier1).toBe(3);
  });

  it("throws ConfigNotFoundError when no rules exist", async () => {
    const { db } = createFakeDatabase();
    await expect(getRulesWithVersion({ db })).rejects.toThrow(ConfigNotFoundError);
  });
});
