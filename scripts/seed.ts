import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getEnv } from "../src/config/env";
import { appConfig } from "../drizzle/schema";

const PLACEHOLDER_RULES = {
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

const PLACEHOLDER_PACKS = {
  key: "credit_packs",
  version: 1,
  placeholder: true,
  value: [
    { id: "starter", credits: 5, priceInPaise: 19900 },
    { id: "growth", credits: 15, priceInPaise: 49900 },
    { id: "pro", credits: 40, priceInPaise: 99900 },
  ],
};

async function main() {
  const env = getEnv();
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  const db = drizzle(pool);
  await db.insert(appConfig).values(PLACEHOLDER_RULES).onConflictDoNothing();
  await db.insert(appConfig).values(PLACEHOLDER_PACKS).onConflictDoNothing();
  await pool.end();
  console.log("Seeded placeholder app_config (rules v1, credit_packs v1).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
