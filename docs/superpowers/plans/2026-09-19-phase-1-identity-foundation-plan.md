# Phase 1 Identity Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build GetNudgd's identity foundation — users, Seeker/Insider profiles, company/domain records, Firebase-shaped sign-in behind a fake adapter, work-email OTP for Insiders, session cookies, and `authorize()` — so every later Phase 1 module (insiders search, resumes, requests, rewards) has a real user/session/authorization layer to build on.

**Architecture:** A new `src/adapters/auth` interface (Firebase-shaped: `verifyIdToken`) with only a fake implementation in this plan — the real Firebase Admin SDK implementation is deferred to a follow-up task once the founder has a Firebase project and credentials, exactly like Phase 0 deferred `src/adapters/storage/real.ts` and `src/adapters/email/real.ts`. The `Database` interface gains an `identity` sub-interface (same fake/real pattern as `ledger`/`config` from Phase 0). `src/modules/identity` is pure domain logic (no Next.js). Session cookie issuance and reading are Next.js-specific glue in `src/lib/session.ts`, kept separate from the pure module per AGENTS.md Part 2.2. `src/lib/authorize.ts` implements the one authorization chokepoint AGENTS.md §3.6 requires.

**Tech Stack:** Drizzle ORM (existing), Zod (existing), Node's built-in `crypto` module for HMAC-signed session cookies (no new dependency — avoids adding a JWT library for a need this simple).

**Spec:** `AGENTS.md` at the repo root — specifically §0.2 (founder facts), §1.4 (data model), Part 2 (shared rules), §3.2 (module table — `identity` row), §3.6 (authorize()), §3.7 (migrations), Part 7 (env vars — `SESSION_COOKIE_SECRET`, Firebase vars). No separate design doc: this plan implements AGENTS.md's already-specified `identity` module scope, and the founder has explicitly decided (this session) that identity is built behind a fake `AuthAdapter` now, with real Firebase wiring deferred to a follow-up once a Firebase project exists — mirroring the Docker/Postgres and storage/email deferrals from the completed Phase 0 plans.

## Global Constraints

- TypeScript strict, no `any`, no `@ts-ignore`; Zod at every boundary (AGENTS.md Part 2.1).
- Domain modules (`src/modules/identity`) import no Next.js, no Drizzle, no vendor SDK — they take a `deps` object (Part 2.2). Session-cookie glue (`next/headers`) lives in `src/lib/session.ts`, never inside `src/modules/identity`.
- Every vendor is behind an interface with a fake, added in the same task as the interface (Part 2.3). The real Firebase adapter is explicitly out of scope for this plan (see Architecture).
- No secret in a `NEXT_PUBLIC_` variable (Part 2.6). `SESSION_COOKIE_SECRET` is a server-only secret.
- One authorization chokepoint: `authorize(session, action, resource)` in `src/lib/authorize.ts`, unit-tested per denial case (§3.6).
- Small, verified commits with `type(scope): summary` messages; run `npm run lint && npm run typecheck && npm test` before every commit (Part 2.10). This plan executes on a task branch off `main`.
- Do not add dependencies without a stated reason (Part 2.11) — this plan adds none; session signing uses Node's built-in `crypto`.
- Locked vocabulary applies: Insider, Seeker, never "referrer"/"job seeker" as an identifier (§0.4).
- No Postgres/Docker is available in this environment (same constraint as Phase 0) — `real.ts` additions in this plan must typecheck but cannot be executed against a live database here; this is expected, not a blocker.

---

## Task 1: Drizzle schema — users, profiles, companies, work-email OTPs

**Files:**
- Modify: `drizzle/schema.ts`
- Create: `drizzle/migrations/0002_identity.sql` (generated, then possibly hand-adjusted)

**Interfaces:**
- Produces: `users`, `seekerProfiles`, `insiderProfiles`, `companies`, `companyDomains`, `workEmailOtps` Drizzle table objects — consumed by Task 2's `real.ts` additions.

- [ ] **Step 1: Add the six tables to `drizzle/schema.ts`**

Append to the existing file (which already has `appConfig`, `ledgerAccounts`, `ledgerTxns`, `ledgerEntries` from Phase 0 — do not modify those):

```ts
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firebaseUid: text("firebase_uid").notNull(),
    email: text("email").notNull(),
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    firebaseUidIdx: uniqueIndex("users_firebase_uid_idx").on(table.firebaseUid),
    emailIdx: uniqueIndex("users_email_idx").on(table.email),
    roleCheck: check("users_role_check", sql`${table.role} in ('seeker','insider','admin','both')`),
  })
);

export const seekerProfiles = pgTable(
  "seeker_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    fullName: text("full_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: uniqueIndex("seeker_profiles_user_id_idx").on(table.userId),
  })
);

export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  tier: text("tier").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const companyDomains = pgTable(
  "company_domains",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    domain: text("domain").notNull(),
  },
  (table) => ({
    domainIdx: uniqueIndex("company_domains_domain_idx").on(table.domain),
  })
);

export const insiderProfiles = pgTable(
  "insider_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    workEmail: text("work_email").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    available: boolean("available").notNull().default(true),
    weeklyLimit: integer("weekly_limit").notNull().default(3),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: uniqueIndex("insider_profiles_user_id_idx").on(table.userId),
  })
);

export const workEmailOtps = pgTable("work_email_otps", {
  id: uuid("id").primaryKey().defaultRandom(),
  insiderProfileId: uuid("insider_profile_id").notNull().references(() => insiderProfiles.id),
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

`boolean` needs importing alongside the other `drizzle-orm/pg-core` imports already at the top of the file (`pgTable, uuid, text, integer, timestamp, jsonb, boolean, uniqueIndex, check` — `boolean` and `check` are likely already imported from Phase 0's `ledgerAccounts`/`appConfig` definitions; if not, add them).

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a new file under `drizzle/migrations/`. Rename it to `drizzle/migrations/0002_identity.sql` (matching the `0000_init.sql`/`0001_ledger_integrity.sql` naming convention from Phase 0) and update `drizzle/migrations/meta/_journal.json` to register it as the third entry, same pattern as Phase 0 Task 3.

- [ ] **Step 3: Verify**

Run: `npm run typecheck` — must pass.
Migration application against a live database is out of scope here (no Postgres available); this matches the Phase 0 pattern and should be reported as `DONE_WITH_CONCERNS`.

- [ ] **Step 4: Commit**

```bash
git add drizzle/schema.ts drizzle/migrations
git commit -m "feat(db): add users, seeker/insider profiles, companies, and work-email OTP schema"
```

---

## Task 2: Extend the Database adapter with an `identity` sub-interface

**Files:**
- Modify: `src/adapters/db/types.ts`
- Modify: `src/adapters/db/fake.ts`
- Modify: `src/adapters/db/fake.test.ts`
- Modify: `src/adapters/db/real.ts`

**Interfaces:**
- Consumes: `users`, `seekerProfiles`, `insiderProfiles`, `companies`, `companyDomains`, `workEmailOtps` from `drizzle/schema.ts` (Task 1).
- Produces: `Role`, `UserRecord`, `CompanyRecord`, `SeekerProfileRecord`, `InsiderProfileRecord` types and a `Database.identity` sub-interface — consumed by Task 3's `identity` module.

- [ ] **Step 1: Add types to `src/adapters/db/types.ts`**

Append (do not modify the existing `Ledger*`/`AppConfigRecord`/`Database` exports from Phase 0 — extend `Database` with a new top-level key):

```ts
export type Role = "seeker" | "insider" | "admin" | "both";

export interface UserRecord {
  id: string;
  firebaseUid: string;
  email: string;
  role: Role;
  createdAt: Date;
}

export interface CompanyRecord {
  id: string;
  name: string;
  tier: string;
}

export interface SeekerProfileRecord {
  id: string;
  userId: string;
  fullName: string;
}

export interface InsiderProfileRecord {
  id: string;
  userId: string;
  companyId: string;
  workEmail: string;
  verifiedAt: Date | null;
  available: boolean;
  weeklyLimit: number;
}
```

Add this key to the existing `Database` interface, alongside `ledger` and `config`:

```ts
  identity: {
    findOrCreateUser(firebaseUid: string, email: string, role: Role): Promise<UserRecord>;
    getUserById(userId: string): Promise<UserRecord | null>;
    createSeekerProfile(userId: string, fullName: string): Promise<SeekerProfileRecord>;
    createInsiderProfile(userId: string, companyId: string, workEmail: string): Promise<InsiderProfileRecord>;
    findCompanyByDomain(domain: string): Promise<CompanyRecord | null>;
    markInsiderVerified(insiderProfileId: string, verifiedAt: Date): Promise<void>;
    storeWorkEmailOtp(insiderProfileId: string, codeHash: string, expiresAt: Date): Promise<void>;
    consumeWorkEmailOtp(insiderProfileId: string, codeHash: string, now: Date): Promise<boolean>;
  };
```

- [ ] **Step 2: Write the failing tests**

Append to `src/adapters/db/fake.test.ts` (new `describe` blocks; keep the existing `ledger`/`config` blocks untouched):

```ts
describe("createFakeDatabase identity", () => {
  it("finds or creates a user by firebase uid, idempotently", async () => {
    const { db } = createFakeDatabase();
    const first = await db.identity.findOrCreateUser("fb-1", "a@b.com", "seeker");
    const second = await db.identity.findOrCreateUser("fb-1", "a@b.com", "seeker");
    expect(second.id).toBe(first.id);
  });

  it("returns null for a user id that doesn't exist", async () => {
    const { db } = createFakeDatabase();
    expect(await db.identity.getUserById("nope")).toBeNull();
  });

  it("creates a seeker profile linked to a user", async () => {
    const { db } = createFakeDatabase();
    const user = await db.identity.findOrCreateUser("fb-2", "s@b.com", "seeker");
    const profile = await db.identity.createSeekerProfile(user.id, "Priya Sharma");
    expect(profile.userId).toBe(user.id);
    expect(profile.fullName).toBe("Priya Sharma");
  });

  it("finds a company by a seeded domain, and returns null for an unknown domain", async () => {
    const { db, seedCompany } = createFakeDatabase();
    const company = seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    expect((await db.identity.findCompanyByDomain("acme.com"))?.id).toBe(company.id);
    expect(await db.identity.findCompanyByDomain("unknown.com")).toBeNull();
  });

  it("creates an insider profile unverified by default", async () => {
    const { db, seedCompany } = createFakeDatabase();
    const company = seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const user = await db.identity.findOrCreateUser("fb-3", "i@acme.com", "insider");
    const profile = await db.identity.createInsiderProfile(user.id, company.id, "i@acme.com");
    expect(profile.verifiedAt).toBeNull();
    expect(profile.available).toBe(true);
  });

  it("marks an insider profile verified", async () => {
    const { db, seedCompany } = createFakeDatabase();
    const company = seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const user = await db.identity.findOrCreateUser("fb-4", "i2@acme.com", "insider");
    const profile = await db.identity.createInsiderProfile(user.id, company.id, "i2@acme.com");
    const when = new Date();
    await db.identity.markInsiderVerified(profile.id, when);
    expect(profile.verifiedAt).toEqual(when);
  });

  it("consumes a work-email OTP exactly once, rejects reuse", async () => {
    const { db, seedCompany } = createFakeDatabase();
    const company = seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const user = await db.identity.findOrCreateUser("fb-5", "i3@acme.com", "insider");
    const profile = await db.identity.createInsiderProfile(user.id, company.id, "i3@acme.com");
    await db.identity.storeWorkEmailOtp(profile.id, "hash-1", new Date(Date.now() + 60_000));
    expect(await db.identity.consumeWorkEmailOtp(profile.id, "hash-1", new Date())).toBe(true);
    expect(await db.identity.consumeWorkEmailOtp(profile.id, "hash-1", new Date())).toBe(false);
  });

  it("rejects an expired work-email OTP", async () => {
    const { db, seedCompany } = createFakeDatabase();
    const company = seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const user = await db.identity.findOrCreateUser("fb-6", "i4@acme.com", "insider");
    const profile = await db.identity.createInsiderProfile(user.id, company.id, "i4@acme.com");
    await db.identity.storeWorkEmailOtp(profile.id, "hash-2", new Date(Date.now() - 1000));
    expect(await db.identity.consumeWorkEmailOtp(profile.id, "hash-2", new Date())).toBe(false);
  });

  it("rejects a wrong code hash", async () => {
    const { db, seedCompany } = createFakeDatabase();
    const company = seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const user = await db.identity.findOrCreateUser("fb-7", "i5@acme.com", "insider");
    const profile = await db.identity.createInsiderProfile(user.id, company.id, "i5@acme.com");
    await db.identity.storeWorkEmailOtp(profile.id, "hash-correct", new Date(Date.now() + 60_000));
    expect(await db.identity.consumeWorkEmailOtp(profile.id, "hash-wrong", new Date())).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/adapters/db/fake.test.ts`
Expected: FAIL — `db.identity` and `seedCompany` don't exist yet.

- [ ] **Step 4: Add `identity` to `createFakeDatabase()` in `src/adapters/db/fake.ts`**

Add new in-memory arrays alongside the existing `accounts`/`txns`/`configRows` closures, a new `identity` key on the returned `db` object, and a `seedCompany` helper alongside the existing `seedConfig` in the returned object:

```ts
import {
  // ...existing imports...
  Role,
  UserRecord,
  CompanyRecord,
  SeekerProfileRecord,
  InsiderProfileRecord,
} from "./types";

// inside createFakeDatabase(), alongside the existing const accounts/txns/configRows:
const users: UserRecord[] = [];
const seekerProfiles: SeekerProfileRecord[] = [];
const insiderProfiles: InsiderProfileRecord[] = [];
const companies: CompanyRecord[] = [];
const companyDomainToId = new Map<string, string>();
const otps: { insiderProfileId: string; codeHash: string; expiresAt: Date; consumedAt: Date | null }[] = [];

// inside the returned `db` object, add:
  identity: {
    async findOrCreateUser(firebaseUid: string, email: string, role: Role) {
      let user = users.find((u) => u.firebaseUid === firebaseUid);
      if (!user) {
        user = { id: genId(), firebaseUid, email, role, createdAt: new Date() };
        users.push(user);
      }
      return user;
    },
    async getUserById(userId: string) {
      return users.find((u) => u.id === userId) ?? null;
    },
    async createSeekerProfile(userId: string, fullName: string) {
      const profile: SeekerProfileRecord = { id: genId(), userId, fullName };
      seekerProfiles.push(profile);
      return profile;
    },
    async createInsiderProfile(userId: string, companyId: string, workEmail: string) {
      const profile: InsiderProfileRecord = {
        id: genId(), userId, companyId, workEmail, verifiedAt: null, available: true, weeklyLimit: 3,
      };
      insiderProfiles.push(profile);
      return profile;
    },
    async findCompanyByDomain(domain: string) {
      const companyId = companyDomainToId.get(domain);
      if (!companyId) return null;
      return companies.find((c) => c.id === companyId) ?? null;
    },
    async markInsiderVerified(insiderProfileId: string, verifiedAt: Date) {
      const profile = insiderProfiles.find((p) => p.id === insiderProfileId);
      if (profile) profile.verifiedAt = verifiedAt;
    },
    async storeWorkEmailOtp(insiderProfileId: string, codeHash: string, expiresAt: Date) {
      otps.push({ insiderProfileId, codeHash, expiresAt, consumedAt: null });
    },
    async consumeWorkEmailOtp(insiderProfileId: string, codeHash: string, now: Date) {
      const otp = otps.find(
        (o) => o.insiderProfileId === insiderProfileId && o.codeHash === codeHash && !o.consumedAt && o.expiresAt > now
      );
      if (!otp) return false;
      otp.consumedAt = now;
      return true;
    },
  },
```

And add `seedCompany` to the returned `{ db, seedConfig, ... }` object:

```ts
  return {
    db,
    seedConfig: (row: AppConfigRecord) => configRows.push(row),
    seedCompany: (input: { name: string; tier: string }, domains: string[]): CompanyRecord => {
      const company: CompanyRecord = { id: genId(), name: input.name, tier: input.tier };
      companies.push(company);
      for (const domain of domains) companyDomainToId.set(domain, company.id);
      return company;
    },
  };
```

(This changes `createFakeDatabase()`'s return type — update its signature/type annotation if one is declared explicitly to include `seedCompany`.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/adapters/db/fake.test.ts`
Expected: PASS (8 new identity tests + the existing ledger/config tests from Phase 0).

- [ ] **Step 6: Add `identity` to `createRealDatabase()` in `src/adapters/db/real.ts`**

```ts
import { eq, and, isNull, gt } from "drizzle-orm";
import { users, seekerProfiles, insiderProfiles, companies, companyDomains, workEmailOtps } from "../../../drizzle/schema";
// (add these alongside the existing ledgerAccounts/ledgerTxns/ledgerEntries/appConfig imports)

// inside the object returned by createRealDatabase(db), alongside ledger/config:
  identity: {
    async findOrCreateUser(firebaseUid, email, role) {
      const [existing] = await db.select().from(users).where(eq(users.firebaseUid, firebaseUid));
      if (existing) return existing as UserRecord;
      const [created] = await db.insert(users).values({ firebaseUid, email, role }).returning();
      return created as UserRecord;
    },
    async getUserById(userId) {
      const [row] = await db.select().from(users).where(eq(users.id, userId));
      return (row as UserRecord) ?? null;
    },
    async createSeekerProfile(userId, fullName) {
      const [row] = await db.insert(seekerProfiles).values({ userId, fullName }).returning();
      return row as SeekerProfileRecord;
    },
    async createInsiderProfile(userId, companyId, workEmail) {
      const [row] = await db.insert(insiderProfiles).values({ userId, companyId, workEmail }).returning();
      return row as InsiderProfileRecord;
    },
    async findCompanyByDomain(domain) {
      const [row] = await db
        .select({ id: companies.id, name: companies.name, tier: companies.tier })
        .from(companyDomains)
        .innerJoin(companies, eq(companyDomains.companyId, companies.id))
        .where(eq(companyDomains.domain, domain));
      return row ? (row as CompanyRecord) : null;
    },
    async markInsiderVerified(insiderProfileId, verifiedAt) {
      await db.update(insiderProfiles).set({ verifiedAt }).where(eq(insiderProfiles.id, insiderProfileId));
    },
    async storeWorkEmailOtp(insiderProfileId, codeHash, expiresAt) {
      await db.insert(workEmailOtps).values({ insiderProfileId, codeHash, expiresAt });
    },
    async consumeWorkEmailOtp(insiderProfileId, codeHash, now) {
      const [otp] = await db
        .select()
        .from(workEmailOtps)
        .where(
          and(
            eq(workEmailOtps.insiderProfileId, insiderProfileId),
            eq(workEmailOtps.codeHash, codeHash),
            isNull(workEmailOtps.consumedAt),
            gt(workEmailOtps.expiresAt, now)
          )
        );
      if (!otp) return false;
      await db.update(workEmailOtps).set({ consumedAt: now }).where(eq(workEmailOtps.id, otp.id));
      return true;
    },
  },
```

Add the `Role, UserRecord, CompanyRecord, SeekerProfileRecord, InsiderProfileRecord` type imports from `./types` alongside the existing ones. If any Drizzle API call here doesn't match the installed `drizzle-orm` version's actual signature, adjust the call to the correct equivalent API (the same latitude Phase 0's real.ts tasks used) — do not weaken correctness to make it typecheck.

- [ ] **Step 7: Verify**

Run: `npm run typecheck` — `real.ts` must typecheck.
Run: `npm test` — full suite passes (fake tests are the only ones that can run without Postgres).

- [ ] **Step 8: Commit**

```bash
git add src/adapters/db
git commit -m "feat(adapters): extend Database with an identity sub-interface (users, profiles, companies, OTPs)"
```

Report status `DONE_WITH_CONCERNS`: `real.ts`'s identity methods have not been exercised against a live Postgres instance.

---

## Task 3: `src/adapters/auth` — the Firebase-shaped interface and its fake

**Files:**
- Create: `src/adapters/auth/types.ts`
- Create: `src/adapters/auth/fake.ts`
- Create: `src/adapters/auth/fake.test.ts`

**Interfaces:**
- Produces: `VerifiedIdentity`, `AuthAdapter`, `InvalidTokenError`, `createFakeAuthAdapter(): { adapter: AuthAdapter; issueToken(identity: VerifiedIdentity): string }` — consumed by Task 4's identity module.

This plan does **not** build `src/adapters/auth/real.ts` — per this session's founder decision, the real Firebase Admin SDK implementation is deferred to a follow-up task once a Firebase project and credentials exist, exactly matching how Phase 0 deferred `src/adapters/storage/real.ts` and `src/adapters/email/real.ts`.

- [ ] **Step 1: Write `src/adapters/auth/types.ts`**

```ts
export interface VerifiedIdentity {
  providerUid: string;
  email: string;
}

export interface AuthAdapter {
  verifyIdToken(idToken: string): Promise<VerifiedIdentity>;
}

export class InvalidTokenError extends Error {
  constructor() {
    super("Invalid or expired ID token");
    this.name = "InvalidTokenError";
  }
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/adapters/auth/fake.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createFakeAuthAdapter } from "./fake";
import { InvalidTokenError } from "./types";

describe("createFakeAuthAdapter", () => {
  it("round-trips an issued token back to the same identity", async () => {
    const { adapter, issueToken } = createFakeAuthAdapter();
    const token = issueToken({ providerUid: "fb-123", email: "a@b.com" });
    const identity = await adapter.verifyIdToken(token);
    expect(identity).toEqual({ providerUid: "fb-123", email: "a@b.com" });
  });

  it("rejects a malformed token", async () => {
    const { adapter } = createFakeAuthAdapter();
    await expect(adapter.verifyIdToken("not-a-real-token")).rejects.toThrow(InvalidTokenError);
  });

  it("rejects a token missing required fields", async () => {
    const { adapter } = createFakeAuthAdapter();
    const bogus = Buffer.from(JSON.stringify({ email: "a@b.com" })).toString("base64url");
    await expect(adapter.verifyIdToken(bogus)).rejects.toThrow(InvalidTokenError);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/adapters/auth/fake.test.ts`
Expected: FAIL — `./fake` does not exist yet.

- [ ] **Step 4: Write `src/adapters/auth/fake.ts`**

```ts
import type { AuthAdapter, VerifiedIdentity } from "./types";
import { InvalidTokenError } from "./types";

export function createFakeAuthAdapter(): { adapter: AuthAdapter; issueToken(identity: VerifiedIdentity): string } {
  return {
    adapter: {
      async verifyIdToken(idToken: string): Promise<VerifiedIdentity> {
        let decoded: unknown;
        try {
          decoded = JSON.parse(Buffer.from(idToken, "base64url").toString("utf8"));
        } catch {
          throw new InvalidTokenError();
        }
        if (
          typeof decoded !== "object" ||
          decoded === null ||
          typeof (decoded as VerifiedIdentity).providerUid !== "string" ||
          typeof (decoded as VerifiedIdentity).email !== "string"
        ) {
          throw new InvalidTokenError();
        }
        return decoded as VerifiedIdentity;
      },
    },
    issueToken(identity: VerifiedIdentity): string {
      return Buffer.from(JSON.stringify(identity)).toString("base64url");
    },
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/adapters/auth/fake.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/adapters/auth
git commit -m "feat(adapters): add Firebase-shaped AuthAdapter interface with a fake implementation"
```

---

## Task 4: `src/modules/identity` — sign-in and work-email OTP

**Files:**
- Create: `src/modules/identity/schemas.ts`
- Create: `src/modules/identity/identity.ts`
- Create: `src/modules/identity/identity.test.ts`

**Interfaces:**
- Consumes: `Database`, `Role` from `src/adapters/db/types.ts` (Task 2); `AuthAdapter` from `src/adapters/auth/types.ts` (Task 3); `createFakeDatabase` and `createFakeAuthAdapter` for tests.
- Produces: `SessionUser`, `signInWithFirebaseToken(deps, idToken)`, `WorkEmailDomainError`, `startWorkEmailOtp(deps, userId, workEmail)`, `verifyWorkEmailOtp(deps, insiderProfileId, code)` — consumed by later Phase 1 plans' server actions and by Task 5's session module.

- [ ] **Step 1: Write `src/modules/identity/schemas.ts`**

```ts
import { z } from "zod";

export const roleSchema = z.enum(["seeker", "insider", "admin", "both"]);
export type RoleInput = z.infer<typeof roleSchema>;

export const signInWithFirebaseTokenInputSchema = z.object({
  idToken: z.string().min(1),
});

export const startWorkEmailOtpInputSchema = z.object({
  userId: z.string().uuid(),
  workEmail: z.string().email(),
});

export const verifyWorkEmailOtpInputSchema = z.object({
  insiderProfileId: z.string().uuid(),
  code: z.string().length(6),
});
```

- [ ] **Step 2: Write the failing tests**

Create `src/modules/identity/identity.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createFakeDatabase } from "../../adapters/db/fake";
import { createFakeAuthAdapter } from "../../adapters/auth/fake";
import {
  signInWithFirebaseToken,
  startWorkEmailOtp,
  verifyWorkEmailOtp,
  WorkEmailDomainError,
  type IdentityDeps,
} from "./identity";

function makeDeps(): { deps: IdentityDeps; issueToken: ReturnType<typeof createFakeAuthAdapter>["issueToken"]; seedCompany: ReturnType<typeof createFakeDatabase>["seedCompany"] } {
  const { db, seedCompany } = createFakeDatabase();
  const { adapter, issueToken } = createFakeAuthAdapter();
  return { deps: { db, auth: adapter }, issueToken, seedCompany };
}

describe("signInWithFirebaseToken", () => {
  it("creates a new seeker user on first sign-in", async () => {
    const { deps, issueToken } = makeDeps();
    const token = issueToken({ providerUid: "fb-1", email: "a@b.com" });
    const session = await signInWithFirebaseToken(deps, token);
    expect(session.role).toBe("seeker");
    expect(session.userId).toBeTruthy();
  });

  it("returns the same user on repeated sign-in with the same token identity", async () => {
    const { deps, issueToken } = makeDeps();
    const token = issueToken({ providerUid: "fb-2", email: "b@b.com" });
    const first = await signInWithFirebaseToken(deps, token);
    const second = await signInWithFirebaseToken(deps, token);
    expect(second.userId).toBe(first.userId);
  });

  it("rejects an invalid token", async () => {
    const { deps } = makeDeps();
    await expect(signInWithFirebaseToken(deps, "garbage")).rejects.toThrow();
  });
});

describe("startWorkEmailOtp", () => {
  it("creates an insider profile and a code when the domain is registered", async () => {
    const { deps, seedCompany } = makeDeps();
    seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const result = await startWorkEmailOtp(deps, "user-1", "person@acme.com");
    expect(result.insiderProfileId).toBeTruthy();
    expect(result.code).toMatch(/^\d{6}$/);
  });

  it("rejects a work email whose domain has no registered company", async () => {
    const { deps } = makeDeps();
    await expect(startWorkEmailOtp(deps, "user-1", "person@unknown.com")).rejects.toThrow(WorkEmailDomainError);
  });

  it("rejects a malformed email with no domain", async () => {
    const { deps } = makeDeps();
    await expect(startWorkEmailOtp(deps, "user-1", "not-an-email")).rejects.toThrow();
  });
});

describe("verifyWorkEmailOtp", () => {
  it("verifies the insider profile when the code matches", async () => {
    const { deps, seedCompany } = makeDeps();
    seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const { insiderProfileId, code } = await startWorkEmailOtp(deps, "user-1", "person@acme.com");
    const ok = await verifyWorkEmailOtp(deps, insiderProfileId, code);
    expect(ok).toBe(true);
  });

  it("rejects a wrong code", async () => {
    const { deps, seedCompany } = makeDeps();
    seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const { insiderProfileId } = await startWorkEmailOtp(deps, "user-1", "person@acme.com");
    const ok = await verifyWorkEmailOtp(deps, insiderProfileId, "000000");
    expect(ok).toBe(false);
  });

  it("rejects reusing an already-consumed code", async () => {
    const { deps, seedCompany } = makeDeps();
    seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const { insiderProfileId, code } = await startWorkEmailOtp(deps, "user-1", "person@acme.com");
    expect(await verifyWorkEmailOtp(deps, insiderProfileId, code)).toBe(true);
    expect(await verifyWorkEmailOtp(deps, insiderProfileId, code)).toBe(false);
  });

  it("rejects an expired code", async () => {
    vi.useFakeTimers();
    const { deps, seedCompany } = makeDeps();
    seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const { insiderProfileId, code } = await startWorkEmailOtp(deps, "user-1", "person@acme.com");
    vi.advanceTimersByTime(11 * 60 * 1000);
    expect(await verifyWorkEmailOtp(deps, insiderProfileId, code)).toBe(false);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/modules/identity/identity.test.ts`
Expected: FAIL — `./identity` does not exist yet.

- [ ] **Step 4: Write `src/modules/identity/identity.ts`**

```ts
import { createHash, randomInt } from "node:crypto";
import type { Database, Role } from "../../adapters/db/types";
import type { AuthAdapter } from "../../adapters/auth/types";

export interface IdentityDeps {
  db: Database;
  auth: AuthAdapter;
}

export interface SessionUser {
  userId: string;
  role: Role;
}

export async function signInWithFirebaseToken(deps: IdentityDeps, idToken: string): Promise<SessionUser> {
  const identity = await deps.auth.verifyIdToken(idToken);
  const user = await deps.db.identity.findOrCreateUser(identity.providerUid, identity.email, "seeker");
  return { userId: user.id, role: user.role };
}

export class WorkEmailDomainError extends Error {
  constructor(domain: string) {
    super(`No company is registered for the work email domain "${domain}"`);
    this.name = "WorkEmailDomainError";
  }
}

const OTP_TTL_MS = 10 * 60 * 1000;

function hashOtpCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export interface StartWorkEmailOtpResult {
  insiderProfileId: string;
  /** Caller (a server action) is responsible for emailing this — never log it or return it in an HTTP response body. */
  code: string;
}

export async function startWorkEmailOtp(
  deps: IdentityDeps,
  userId: string,
  workEmail: string
): Promise<StartWorkEmailOtpResult> {
  const domain = workEmail.split("@")[1]?.toLowerCase();
  if (!domain) throw new Error("Invalid work email");

  const company = await deps.db.identity.findCompanyByDomain(domain);
  if (!company) throw new WorkEmailDomainError(domain);

  const profile = await deps.db.identity.createInsiderProfile(userId, company.id, workEmail);
  const code = generateOtpCode();
  await deps.db.identity.storeWorkEmailOtp(profile.id, hashOtpCode(code), new Date(Date.now() + OTP_TTL_MS));
  return { insiderProfileId: profile.id, code };
}

export async function verifyWorkEmailOtp(deps: IdentityDeps, insiderProfileId: string, code: string): Promise<boolean> {
  const valid = await deps.db.identity.consumeWorkEmailOtp(insiderProfileId, hashOtpCode(code), new Date());
  if (valid) await deps.db.identity.markInsiderVerified(insiderProfileId, new Date());
  return valid;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/modules/identity/identity.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 6: Commit**

```bash
git add src/modules/identity
git commit -m "feat(identity): add signInWithFirebaseToken and work-email OTP flow"
```

---

## Task 5: `src/lib/session.ts` — HMAC-signed HttpOnly session cookie

**Files:**
- Create: `src/lib/session.ts`
- Create: `src/lib/session.test.ts`

**Interfaces:**
- Consumes: `Role` from `src/adapters/db/types.ts` (Task 2); `getEnv` from `src/config/env.ts`.
- Produces: `SessionPayload`, `encodeSession(payload, secret)`, `decodeSession(token, secret)`, `setSessionCookie(payload)`, `getSessionFromCookies()`, `clearSessionCookie()` — consumed by later Phase 1 plans' layouts/server actions and by Task 6's `authorize()`.

`encodeSession`/`decodeSession` are pure functions and are exhaustively tested. `setSessionCookie`/`getSessionFromCookies`/`clearSessionCookie` wrap Next.js's `cookies()` API and are thin, untestable-without-a-request-context glue (consistent with how Phase 0 treated `app/api/health/route.ts` as a thin wrapper over its pure `getHealthReport` function) — they are not unit tested here, only typechecked.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/session.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { encodeSession, decodeSession, type SessionPayload } from "./session";

const SECRET = "test-secret-at-least-32-characters-long";

describe("encodeSession / decodeSession", () => {
  it("round-trips a payload", () => {
    const payload: SessionPayload = { userId: "u1", role: "seeker", issuedAt: Date.now() };
    const token = encodeSession(payload, SECRET);
    expect(decodeSession(token, SECRET)).toEqual(payload);
  });

  it("rejects a token signed with a different secret", () => {
    const payload: SessionPayload = { userId: "u1", role: "seeker", issuedAt: Date.now() };
    const token = encodeSession(payload, SECRET);
    expect(decodeSession(token, "a-completely-different-secret-value")).toBeNull();
  });

  it("rejects a tampered payload segment", () => {
    const payload: SessionPayload = { userId: "u1", role: "seeker", issuedAt: Date.now() };
    const token = encodeSession(payload, SECRET);
    const [, signature] = token.split(".");
    const tamperedBody = Buffer.from(JSON.stringify({ userId: "u2", role: "admin", issuedAt: 0 })).toString("base64url");
    expect(decodeSession(`${tamperedBody}.${signature}`, SECRET)).toBeNull();
  });

  it("rejects a malformed token with no signature segment", () => {
    expect(decodeSession("not-a-valid-token", SECRET)).toBeNull();
  });

  it("rejects an empty token", () => {
    expect(decodeSession("", SECRET)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/session.test.ts`
Expected: FAIL — `./session` does not exist yet.

- [ ] **Step 3: Write `src/lib/session.ts`**

```ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getEnv } from "../config/env";
import type { Role } from "../adapters/db/types";

export interface SessionPayload {
  userId: string;
  role: Role;
  issuedAt: number;
}

const SESSION_COOKIE_NAME = "gn_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function encodeSession(payload: SessionPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function decodeSession(token: string, secret: string): SessionPayload | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const expected = sign(body, secret);
  const actual = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (actual.length !== expectedBuf.length || !timingSafeEqual(actual, expectedBuf)) return null;

  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
  } catch {
    return null;
  }
}

export async function setSessionCookie(payload: SessionPayload): Promise<void> {
  const env = getEnv();
  const token = encodeSession(payload, env.SESSION_COOKIE_SECRET);
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
  });
}

export async function getSessionFromCookies(): Promise<SessionPayload | null> {
  const env = getEnv();
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return decodeSession(token, env.SESSION_COOKIE_SECRET);
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/session.test.ts`
Expected: PASS (5 tests).
Run: `npm run typecheck` — confirms `setSessionCookie`/`getSessionFromCookies`/`clearSessionCookie` typecheck against `next/headers`'s `cookies()` API.

- [ ] **Step 5: Commit**

```bash
git add src/lib/session.ts src/lib/session.test.ts
git commit -m "feat(session): add HMAC-signed HttpOnly session cookie encode/decode and Next.js glue"
```

---

## Task 6: `src/lib/authorize.ts` — the authorization chokepoint

**Files:**
- Create: `src/lib/authorize.ts`
- Create: `src/lib/authorize.test.ts`

**Interfaces:**
- Consumes: `SessionPayload` from `src/lib/session.ts` (Task 5).
- Produces: `Action`, `ResourceType`, `Resource`, `authorize(session, action, resource)` — consumed by every future server action per AGENTS.md §4.4 ("Zod → `authorize()` → module call → `revalidatePath`").

This task's `ResourceType`/denial rules are scoped to what exists after this plan (own seeker/insider profile, own user record). Later Phase 1 plans (insiders, resumes, requests) extend this same file with more `ResourceType` values and rules as those resources are built — this task establishes the pattern and the one chokepoint AGENTS.md §3.6 requires, not the full eventual rule set.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/authorize.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { authorize } from "./authorize";
import type { SessionPayload } from "./session";

const seekerSession: SessionPayload = { userId: "u1", role: "seeker", issuedAt: 0 };
const adminSession: SessionPayload = { userId: "admin-1", role: "admin", issuedAt: 0 };

describe("authorize", () => {
  it("denies when there is no session", () => {
    expect(authorize(null, "read", { type: "seekerProfile", ownerUserId: "u1" })).toBe(false);
  });

  it("allows a user to read their own resource", () => {
    expect(authorize(seekerSession, "read", { type: "seekerProfile", ownerUserId: "u1" })).toBe(true);
  });

  it("allows a user to update their own resource", () => {
    expect(authorize(seekerSession, "update", { type: "insiderProfile", ownerUserId: "u1" })).toBe(true);
  });

  it("denies a user accessing someone else's resource", () => {
    expect(authorize(seekerSession, "read", { type: "seekerProfile", ownerUserId: "u2" })).toBe(false);
  });

  it("allows admin to access any resource regardless of owner", () => {
    expect(authorize(adminSession, "update", { type: "seekerProfile", ownerUserId: "u1" })).toBe(true);
    expect(authorize(adminSession, "read", { type: "userRecord", ownerUserId: "someone-else" })).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/authorize.test.ts`
Expected: FAIL — `./authorize` does not exist yet.

- [ ] **Step 3: Write `src/lib/authorize.ts`**

```ts
import type { SessionPayload } from "./session";

export type Action = "read" | "update";
export type ResourceType = "seekerProfile" | "insiderProfile" | "userRecord";

export interface Resource {
  type: ResourceType;
  ownerUserId: string;
}

export function authorize(session: SessionPayload | null, _action: Action, resource: Resource): boolean {
  if (!session) return false;
  if (session.role === "admin") return true;
  return session.userId === resource.ownerUserId;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/authorize.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/authorize.ts src/lib/authorize.test.ts
git commit -m "feat(authz): add the authorize() chokepoint for own-resource and admin access"
```

---

## Task 7: Require `SESSION_COOKIE_SECRET`, seed placeholder companies

**Files:**
- Modify: `src/config/env.ts`
- Modify: `src/config/env.test.ts`
- Modify: `.env.local.example`
- Modify: `scripts/seed.ts`

**Interfaces:**
- Consumes: `getEnv` (modifying its schema), `appConfig` seeding pattern from Phase 0's `scripts/seed.ts`.
- Produces: `env.SESSION_COOKIE_SECRET` as a required, validated string (was optional in Phase 0) — consumed by Task 5's `session.ts`.

- [ ] **Step 1: Update the failing test first**

In `src/config/env.test.ts`, change the `REQUIRED_ENV` fixture to include a session secret, and add a new test:

```ts
const REQUIRED_ENV = {
  APP_URL: "http://localhost:3000",
  BRAND_NAME: "GetNudgd",
  BRAND_DOMAIN: "getnudgd.com",
  DATABASE_URL: "postgres://getnudgd:getnudgd@localhost:5432/getnudgd",
  SESSION_COOKIE_SECRET: "a-test-secret-that-is-at-least-32-characters-long",
};
```

Add a new test case in the existing `describe("getEnv", ...)` block:

```ts
  it("throws when SESSION_COOKIE_SECRET is missing", () => {
    delete process.env.SESSION_COOKIE_SECRET;
    expect(() => getEnv()).toThrow(/SESSION_COOKIE_SECRET/);
  });

  it("throws when SESSION_COOKIE_SECRET is too short", () => {
    process.env.SESSION_COOKIE_SECRET = "too-short";
    expect(() => getEnv()).toThrow(/SESSION_COOKIE_SECRET/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/config/env.test.ts`
Expected: FAIL — `SESSION_COOKIE_SECRET` is still `.optional()` in the schema, so a missing/short value doesn't throw yet.

- [ ] **Step 3: Update `src/config/env.ts`**

Change the line:
```ts
  SESSION_COOKIE_SECRET: z.string().optional(),
```
to:
```ts
  SESSION_COOKIE_SECRET: z.string().min(32, "SESSION_COOKIE_SECRET must be at least 32 characters"),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/config/env.test.ts`
Expected: PASS (8 tests: the original 6 plus the 2 new ones).
Run: `npm test` — full suite passes (every other test file that calls `getEnv()` indirectly must still work; check `src/lib/session.test.ts` doesn't call `getEnv()` directly — it only tests the pure `encodeSession`/`decodeSession` functions, so it's unaffected).

- [ ] **Step 5: Update `.env.local.example`**

Add a line:
```
SESSION_COOKIE_SECRET=change-this-to-a-random-32-plus-character-string-for-local-dev
```

- [ ] **Step 6: Update `scripts/seed.ts` to seed placeholder companies**

Add alongside the existing `PLACEHOLDER_RULES`/`PLACEHOLDER_PACKS` inserts:

```ts
import { companies, companyDomains } from "../drizzle/schema";

const PLACEHOLDER_COMPANIES = [
  { name: "Acme Technologies", tier: "tier1", domains: ["acme.com"] },
  { name: "Beta Systems", tier: "tier2", domains: ["betasystems.com"] },
  { name: "Gamma Labs", tier: "tier3", domains: ["gammalabs.io"] },
];
```

In `main()`, after the existing `app_config` inserts:

```ts
  for (const company of PLACEHOLDER_COMPANIES) {
    const [row] = await db.insert(companies).values({ name: company.name, tier: company.tier }).returning();
    for (const domain of company.domains) {
      await db.insert(companyDomains).values({ companyId: row.id, domain }).onConflictDoNothing();
    }
  }
  console.log(`Seeded ${PLACEHOLDER_COMPANIES.length} placeholder companies.`);
```

- [ ] **Step 7: Verify**

Run: `npm run typecheck` — must pass.
Run: `npm test` — full suite passes.
`scripts/seed.ts`'s new company-seeding code cannot be executed without Postgres — expected, matching every other Phase 0/1 database-touching script.

- [ ] **Step 8: Commit**

```bash
git add src/config/env.ts src/config/env.test.ts .env.local.example scripts/seed.ts
git commit -m "feat(config): require SESSION_COOKIE_SECRET, seed placeholder companies and domains"
```

Report status `DONE_WITH_CONCERNS`: the seed script's new inserts are unverified against a live database.

---

## Plan Self-Review Notes

- **Spec coverage:** AGENTS.md §3.2's `identity` module row lists `signInWithFirebaseToken`, `startWorkEmailOtp`, `verifyWorkEmailOtp`, `getSessionUser` as example functions. The first three are built (Task 4). `getSessionUser` as a *module* function isn't needed as a separate export — its job (reading the current session) is `getSessionFromCookies()` in Task 5, which is deliberately Next.js-specific glue rather than pure domain logic, since "the current session" is inherently a request-scoped concept. Any later plan needing a pure "resolve a `SessionPayload` to a `UserRecord`" helper can add `db.identity.getUserById(session.userId)` directly — the primitive already exists from Task 2.
- **Deliberately deferred, with rationale in Global Constraints:** `src/adapters/auth/real.ts` (no Firebase project/credentials exist yet — founder's explicit decision this session); `target_companies` table (AGENTS.md §1.4 lists it, but nothing in this plan's scope — sign-in, work-email OTP, sessions, authorize — needs it; it belongs with the `requests`/`insiders` plan that actually uses company tiers for cost calculation).
- **Correction (added after the whole-branch final review — do not trust the line this replaces):** an earlier version of this note claimed Google sign-in and phone OTP were "facets of the *real* adapter's implementation, not the interface" and required no schema/interface changes. That claim does not hold: (1) `real.ts`'s `findOrCreateUser` keys only on `firebaseUid`, so the same person signing in via Google vs. email-link gets two different Firebase UIDs sharing one email and collides on `users_email_idx`, hard-locking them out; (2) phone-OTP sign-in produces no email at all, but `VerifiedIdentity.email` and `users.email` are both required non-null strings — phone sign-in cannot be represented by the current interface or table at all. Before the real Firebase adapter is built, decide whether `users.email` becomes nullable and/or whether identity keys on `(provider, providerUid)` pairs instead of raw `firebaseUid`. This is now tracked as finding #5 in `.superpowers/sdd/2026-09-19-phase-1-identity-foundation-plan/progress.md`'s final-review section, prioritized as an early task of the next Phase 1 sub-plan.
- **Type consistency:** `Role` is defined once in `src/adapters/db/types.ts` (Task 2) and imported everywhere else (`identity.ts`, `session.ts`, `authorize.test.ts`) rather than redefined — checked across all four files that reference it.
- **Next plans:** insiders search + resumes upload registration (consumes `insiderProfiles`/`companies` from this plan, plus `authorize()`'s `ResourceType` union will grow); then requests.sendRequest+escrow+lifecycle+admin verify+rewards+notifications+timers+Playwright (the largest remaining slice, consumes the request state machine and ledger already built in Phase 0). Both are separate plans, written after this one lands, per the writing-plans skill's guidance to decompose an oversized spec into sub-project plans.
