import type { Rules } from "../config/schemas";

export class RewardsNotConfiguredError extends Error {
  constructor(field: string) {
    super(`Rewards config is missing "${field}" in the rules version in use`);
    this.name = "RewardsNotConfiguredError";
  }
}

export function requireRewardsConfig(rules: Rules): {
  pointsPerCredit: number;
  paisePerPoint: number;
  giftCardBrands: string[];
} {
  if (rules.pointsPerCredit === undefined) throw new RewardsNotConfiguredError("pointsPerCredit");
  if (rules.paisePerPoint === undefined) throw new RewardsNotConfiguredError("paisePerPoint");
  if (rules.giftCardBrands === undefined) throw new RewardsNotConfiguredError("giftCardBrands");
  return {
    pointsPerCredit: rules.pointsPerCredit,
    paisePerPoint: rules.paisePerPoint,
    giftCardBrands: rules.giftCardBrands,
  };
}

export function computeTranchePoints(rules: Rules, creditCost: number, tranche: 1 | 2): number {
  if (rules.pointsPerCredit === undefined) throw new RewardsNotConfiguredError("pointsPerCredit");
  const percent = tranche === 1 ? rules.tranche1Percent : rules.tranche2Percent;
  return Math.round((creditCost * rules.pointsPerCredit * percent) / 100);
}
