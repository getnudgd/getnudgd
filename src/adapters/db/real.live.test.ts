// @vitest-environment node
// Live test against a real Postgres (dev compose). Skipped unless RUN_VENDOR_TESTS=1.
// Run: export $(grep -v '^#' .env.local | grep -v '^$' | xargs -d '\n'); npm run db:migrate; npm run db:seed;
//      RUN_VENDOR_TESTS=1 npx vitest run src/adapters/db/real.live.test.ts
//
// Exercises identity DB methods that need real Postgres behavior a fake cannot prove:
// createOrGetSeekerProfile's ON CONFLICT race-safety under an actual concurrent double-submit,
// and storeWorkEmailOtp's prior-code invalidation inside a real transaction.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { createRealDatabase } from "./real";
import type { Database } from "./types";

const live = process.env.RUN_VENDOR_TESTS === "1";

describe.skipIf(!live)("identity DB methods against real Postgres", () => {
  const tag = Date.now().toString(36);
  let pool: Pool;
  let db: Database;
  let companyId: string;
  let userCounter = 0;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = createRealDatabase(drizzle(pool));
    const { rows } = await pool.query<{ id: string }>("select id from companies limit 1");
    if (rows.length === 0) throw new Error("No seeded companies found — run `npm run db:seed` first");
    companyId = rows[0].id;
  });

  afterAll(async () => {
    await pool.end();
  });

  async function makeUser(): Promise<string> {
    userCounter++;
    const user = await db.identity.findOrCreateUser(`fb-live-${tag}-u${userCounter}`, `u-${tag}-${userCounter}@x.com`, "seeker");
    return user.id;
  }

  it("createOrGetSeekerProfile returns the same row for a real concurrent double-submit", async () => {
    const userId = await makeUser();
    const [a, b] = await Promise.all([
      db.identity.createOrGetSeekerProfile(userId, "Race A"),
      db.identity.createOrGetSeekerProfile(userId, "Race B"),
    ]);
    expect(a.record.id).toBe(b.record.id);
    expect([a.created, b.created].filter(Boolean)).toHaveLength(1);

    const { rows } = await pool.query<{ count: string }>(
      "select count(*)::text as count from seeker_profiles where user_id = $1",
      [userId]
    );
    expect(rows[0].count).toBe("1");
  });

  it("storeWorkEmailOtp invalidates a prior unconsumed code on resend, in real Postgres", async () => {
    const userId = await makeUser();
    const profile = await db.identity.findOrCreateInsiderProfile(userId, companyId, `insider-${tag}@acme.com`);
    await db.identity.storeWorkEmailOtp(profile.id, "hash-first", new Date(Date.now() + 60_000));
    await db.identity.storeWorkEmailOtp(profile.id, "hash-second", new Date(Date.now() + 60_000));

    expect(await db.identity.consumeWorkEmailOtp(profile.id, "hash-first", new Date())).toBe(false);
    expect(await db.identity.consumeWorkEmailOtp(profile.id, "hash-second", new Date())).toBe(true);
  });

  it("getSeekerProfileByUserId and getInsiderProfileByUserId return null for a user with neither profile", async () => {
    const userId = await makeUser();
    expect(await db.identity.getSeekerProfileByUserId(userId)).toBeNull();
    expect(await db.identity.getInsiderProfileByUserId(userId)).toBeNull();
  });
});
