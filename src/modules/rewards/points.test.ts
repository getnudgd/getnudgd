import { describe, it, expect } from "vitest";
import type { Rules } from "../config/schemas";
import { computeTranchePoints, requireRewardsConfig, RewardsNotConfiguredError } from "./points";

const BASE: Rules = {
  responseWindowHours: 48,
  interviewWindowDays: 14,
  reverificationDays: 90,
  tranche1Percent: 50,
  tranche2Percent: 50,
  refundPercentOnDecline: 100,
  refundPercentOnExpiry: 60,
  minRedemptionPoints: 500,
  panThresholdPoints: 5000,
  freeCreditGrant: 3,
  requestCostByTier: { tier1: 3, tier2: 2, tier3: 1 },
  pointsPerCredit: 40,
  paisePerPoint: 100,
  giftCardBrands: ["amazon", "flipkart"],
};

describe("computeTranchePoints", () => {
  it("pays creditCost x pointsPerCredit x tranche percent for tranche 1 and 2", () => {
    expect(computeTranchePoints(BASE, 3, 1)).toBe(60);
    expect(computeTranchePoints(BASE, 3, 2)).toBe(60);
  });

  it("uses each tranche's own percent and leaves the remainder to the platform", () => {
    const rules = { ...BASE, tranche1Percent: 30, tranche2Percent: 50 };
    expect(computeTranchePoints(rules, 3, 1)).toBe(36);
    expect(computeTranchePoints(rules, 3, 2)).toBe(60);
  });

  it("rounds to the nearest whole point", () => {
    const rules = { ...BASE, pointsPerCredit: 7, tranche1Percent: 50 };
    expect(computeTranchePoints(rules, 1, 1)).toBe(4); // 3.5 -> 4
    expect(computeTranchePoints({ ...rules, tranche1Percent: 10 }, 1, 1)).toBe(1); // 0.7 -> 1
  });

  it("returns 0 for a 0 percent tranche", () => {
    expect(computeTranchePoints({ ...BASE, tranche2Percent: 0 }, 3, 2)).toBe(0);
  });

  it("throws RewardsNotConfiguredError naming pointsPerCredit when it is absent", () => {
    const partial: Partial<Rules> = { ...BASE };
    delete partial.pointsPerCredit;
    const rules = partial as Rules;
    expect(() => computeTranchePoints(rules, 3, 1)).toThrow(RewardsNotConfiguredError);
    expect(() => computeTranchePoints(rules, 3, 1)).toThrow(/pointsPerCredit/);
  });
});

describe("requireRewardsConfig", () => {
  it("returns the three fields when all are present", () => {
    expect(requireRewardsConfig(BASE)).toEqual({ pointsPerCredit: 40, paisePerPoint: 100, giftCardBrands: ["amazon", "flipkart"] });
  });

  it("names the first missing field", () => {
    expect(() => requireRewardsConfig({ ...BASE, paisePerPoint: undefined })).toThrow(/paisePerPoint/);
    expect(() => requireRewardsConfig({ ...BASE, giftCardBrands: undefined })).toThrow(/giftCardBrands/);
  });
});
