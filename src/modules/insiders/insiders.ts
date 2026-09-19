import type { Database, InsiderSearchFilters, InsiderSearchResult } from "../../adapters/db/types";
import { getRules } from "../config/config";
import type { Rules } from "../config/schemas";

export interface InsidersDeps {
  db: Database;
}

export interface InsiderSummary {
  insiderProfileId: string;
  companyName: string;
  companyTier: string;
  creditCost: number;
}

export class UnknownCompanyTierError extends Error {
  constructor(tier: string) {
    super(`No requestCostByTier entry configured for company tier "${tier}"`);
    this.name = "UnknownCompanyTierError";
  }
}

function toSummary(result: InsiderSearchResult, rules: Rules): InsiderSummary {
  const creditCost = rules.requestCostByTier[result.companyTier];
  if (creditCost === undefined) {
    throw new UnknownCompanyTierError(result.companyTier);
  }
  return {
    insiderProfileId: result.insiderProfileId,
    companyName: result.companyName,
    companyTier: result.companyTier,
    creditCost,
  };
}

export async function listInsiders(deps: InsidersDeps, filters: InsiderSearchFilters = {}): Promise<InsiderSummary[]> {
  const results = await deps.db.insiders.listInsiders(filters);
  const rules = await getRules(deps);
  return results.map((r) => toSummary(r, rules));
}

export async function getInsider(deps: InsidersDeps, insiderProfileId: string): Promise<InsiderSummary | null> {
  const result = await deps.db.insiders.getInsiderById(insiderProfileId);
  if (!result) return null;
  const rules = await getRules(deps);
  return toSummary(result, rules);
}

export async function setAvailability(deps: InsidersDeps, insiderProfileId: string, available: boolean): Promise<void> {
  await deps.db.insiders.setAvailability(insiderProfileId, available);
}
