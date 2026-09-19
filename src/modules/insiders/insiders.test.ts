import { describe, it, expect } from "vitest";
import { createFakeDatabase } from "../../adapters/db/fake";
import { listInsiders, getInsider, setAvailability, type InsidersDeps } from "./insiders";

const RULES = {
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

async function makeDepsWithVerifiedInsider(): Promise<{ deps: InsidersDeps; insiderProfileId: string }> {
  const { db, seedConfig, seedCompany } = createFakeDatabase();
  seedConfig(RULES);
  const company = seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
  const user = await db.identity.findOrCreateUser("fb-ins-1", "ins1@acme.com", "seeker");
  const profile = await db.identity.findOrCreateInsiderProfile(user.id, company.id, "ins1@acme.com");
  await db.identity.markInsiderVerified(profile.id, new Date());
  return { deps: { db }, insiderProfileId: profile.id };
}

describe("listInsiders", () => {
  it("returns verified insiders with a computed credit cost from config", async () => {
    const { deps } = await makeDepsWithVerifiedInsider();
    const results = await listInsiders(deps);
    expect(results).toHaveLength(1);
    expect(results[0].companyName).toBe("Acme");
    expect(results[0].creditCost).toBe(3);
  });

  it("returns an empty list when no insiders are seeded", async () => {
    const { db, seedConfig } = createFakeDatabase();
    seedConfig(RULES);
    expect(await listInsiders({ db })).toEqual([]);
  });

  it("passes a company filter through to the database layer", async () => {
    const { deps } = await makeDepsWithVerifiedInsider();
    const results = await listInsiders(deps, { companyId: "some-other-company" });
    expect(results).toHaveLength(0);
  });
});

describe("getInsider", () => {
  it("returns the insider's summary with credit cost", async () => {
    const { deps, insiderProfileId } = await makeDepsWithVerifiedInsider();
    const result = await getInsider(deps, insiderProfileId);
    expect(result?.insiderProfileId).toBe(insiderProfileId);
    expect(result?.creditCost).toBe(3);
  });

  it("returns null for an unknown insider", async () => {
    const { deps } = await makeDepsWithVerifiedInsider();
    expect(await getInsider(deps, "nope")).toBeNull();
  });
});

describe("setAvailability", () => {
  it("makes an available insider disappear from search results", async () => {
    const { deps, insiderProfileId } = await makeDepsWithVerifiedInsider();
    await setAvailability(deps, insiderProfileId, false);
    expect(await listInsiders(deps)).toHaveLength(0);
  });
});
