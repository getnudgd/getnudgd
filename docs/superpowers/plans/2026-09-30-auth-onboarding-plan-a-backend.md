# Auth/Onboarding Plan A — Backend: Auth Plumbing, Gates, and Decision Functions

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give GetNudgd a real, safe identity layer to build `/login`, `/onboard`, and the three app-shell layout guards on top of (Plan B). Nothing in this plan touches `app/**` — every deliverable is a module function, an adapter, or a config value, each independently testable without a page.

**Architecture:** Extend the existing `identity` module and `db` adapter (fake + real) with the profile-lookup and idempotent-creation methods the onboarding flow needs; close the one real security hole in the codebase today (the fake auth adapter is wired unconditionally, in every environment including a hypothetical production build); add three small new `src/lib` utilities (`current-user.ts`, `problems.ts`, `limiters.ts`) that Plan B will call directly from server actions and layouts. Every new function is either pure or takes its dependencies through a `deps` parameter, per this codebase's existing module convention.

**Tech Stack:** TypeScript strict, Zod v4, Drizzle ORM over Postgres 16, Vitest, the existing fake/real adapter pattern.

**Spec:** `docs/superpowers/specs/2026-09-30-auth-onboarding-design.md` (read in full before starting; this plan implements its §4.1–§4.6, §4.10's decision functions, and §4.11).

## Global Constraints

- TypeScript strict, no `any`, no `@ts-ignore`; Zod at every boundary (AGENTS.md §2.1).
- Domain modules (`src/modules/*`) import no Next.js, no Drizzle client, no vendor SDK — dependencies arrive only through a `deps` parameter (AGENTS.md §2.2). `src/lib/*` files are not domain modules and may import adapters/modules directly.
- Every vendor sits behind an interface with a fake added in the same change (AGENTS.md §2.3) — not applicable to new vendors here, but the existing fake/real split must stay in sync for every DB method this plan adds.
- No `NEXT_PUBLIC_` variable may ever hold anything secret (AGENTS.md §2.6) — not touched by this plan, called out because `DEV_LOGIN_ENABLED`/`DEV_MAILBOX_PATH` must NOT be prefixed `NEXT_PUBLIC_`.
- Errors are RFC 7807-style problem details; no vendor or debug text is ever rendered to a client (AGENTS.md §2.7, §4.6).
- TDD: write the failing test, watch it fail, then implement (AGENTS.md §2.9, superpowers:test-driven-development).
- Commit messages: `type(scope): summary`, scope = module or file area touched (AGENTS.md §2.10).
- **`DEV_LOGIN_ENABLED` and `DEV_MAILBOX_PATH` must both fail `getEnv()` when truthy/set and `NODE_ENV === "production"`.** This is the single most safety-critical constraint in this plan (spec §4.1, §4.11).
- **The production auth-adapter fix (Task 2) is the PRIMARY security control**, not `DEV_LOGIN_ENABLED` — the flag is defense in depth on top of it, never a substitute for it (spec §4.1).
- New boolean env vars use `z.stringbool()`, never `z.boolean()` (doesn't parse `process.env` strings) or `z.coerce.boolean()` (treats the string `"false"` as truthy) (spec §4.1).
- Every "is this in production" check in this plan is keyed on `NODE_ENV === "production"` specifically — never `!== "development"`, which would also lock out `NODE_ENV === "test"`.

## Review Focus

- A session cookie whose `userId` no longer exists in `users` (account deleted between cookie issuance and this request) — `getCurrentUserFromDb`/`getCurrentUser` must return `null`, not throw. Covered by Task 6.
- Real concurrent double-submit of `createOrGetSeekerProfile` for the same `userId` (two requests racing, not just two sequential calls) — must yield exactly one row, never a duplicate-key error surfaced to the caller. Covered by Task 3's live test (fakes cannot prove this; the fake-level test in Task 3 proves the output contract only).
- `requestWorkEmailOtp` called twice for two *different* work emails in a row (mid-flow company change) must invalidate the first email's OTP too, not just same-email resends. Covered by Task 5.
- `NODE_ENV === "test"` must behave like development for both the env refusal (Task 1) and the auth-adapter selection (Task 2) — a check written as `!== "development"` would silently break the test suite itself. Covered by Tasks 1 and 2.
- `mapErrorToProblem` given a non-`Error` thrown value that merely *looks* like an error (e.g. a plain `{ message: "..." }` object) must fall through to `"unexpected"` without throwing while inspecting it. Covered by Task 7.

---

## Task 1: Environment gating — `DEV_LOGIN_ENABLED` and `DEV_MAILBOX_PATH`

**Files:**
- Modify: `src/config/env.ts`
- Test: `src/config/env.test.ts`

**Interfaces:**
- Produces: `Env.DEV_LOGIN_ENABLED: boolean` (default `false`), `Env.DEV_MAILBOX_PATH: string | undefined`. `getEnv()` throws when either is set truthy/non-empty while `NODE_ENV === "production"`.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing tests**

Add to `src/config/env.test.ts`, inside the existing `describe("getEnv", ...)` block (after the last `it`, before the closing `});`):

```ts
  it("defaults DEV_LOGIN_ENABLED to false and DEV_MAILBOX_PATH to undefined", () => {
    const env = getEnv();
    expect(env.DEV_LOGIN_ENABLED).toBe(false);
    expect(env.DEV_MAILBOX_PATH).toBeUndefined();
  });

  it("parses DEV_LOGIN_ENABLED=true in development", () => {
    process.env.DEV_LOGIN_ENABLED = "true";
    expect(getEnv().DEV_LOGIN_ENABLED).toBe(true);
  });

  it("parses DEV_LOGIN_ENABLED=false explicitly, not as truthy", () => {
    process.env.DEV_LOGIN_ENABLED = "false";
    expect(getEnv().DEV_LOGIN_ENABLED).toBe(false);
  });

  it("allows DEV_LOGIN_ENABLED=true when NODE_ENV=test, not just development", () => {
    process.env.NODE_ENV = "test";
    process.env.DEV_LOGIN_ENABLED = "true";
    expect(() => getEnv()).not.toThrow();
    expect(getEnv().DEV_LOGIN_ENABLED).toBe(true);
  });

  it("throws when DEV_LOGIN_ENABLED=true and NODE_ENV=production", () => {
    process.env.NODE_ENV = "production";
    process.env.DEV_LOGIN_ENABLED = "true";
    expect(() => getEnv()).toThrow(/DEV_LOGIN_ENABLED/);
  });

  it("throws when DEV_MAILBOX_PATH is set and NODE_ENV=production", () => {
    process.env.NODE_ENV = "production";
    process.env.DEV_MAILBOX_PATH = "/tmp/mailbox.jsonl";
    expect(() => getEnv()).toThrow(/DEV_MAILBOX_PATH/);
  });

  it("allows DEV_MAILBOX_PATH to be set outside production", () => {
    process.env.DEV_MAILBOX_PATH = "/tmp/mailbox.jsonl";
    expect(getEnv().DEV_MAILBOX_PATH).toBe("/tmp/mailbox.jsonl");
  });
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run src/config/env.test.ts`
Expected: FAIL — `DEV_LOGIN_ENABLED`/`DEV_MAILBOX_PATH` are `undefined` (property doesn't exist on the parsed type in a way that satisfies the assertions) and the production-refusal tests fail because nothing throws yet.

- [ ] **Step 3: Implement**

In `src/config/env.ts`, change the `envSchema` declaration from a plain `z.object({...})` to a `z.object({...}).refine(...).refine(...)`, adding the two new fields and the two refusal checks:

```ts
const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_URL: z.string().url(),
    BRAND_NAME: z.string().min(1),
    BRAND_DOMAIN: z.string().min(1),
    DATABASE_URL: z.string().min(1),
    ADAPTERS: z.enum(["fake", "real"]).default("fake"),

    DEV_LOGIN_ENABLED: z.stringbool().default(false),
    DEV_MAILBOX_PATH: z.string().optional(),

    FIREBASE_PROJECT_ID: z.string().optional(),
    FIREBASE_CLIENT_EMAIL: z.string().optional(),
    FIREBASE_PRIVATE_KEY: z.string().optional(),
    NEXT_PUBLIC_FIREBASE_API_KEY: z.string().optional(),
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: z.string().optional(),

    GCS_BUCKET_RESUMES: z.string().optional(),
    GCS_BUCKET_PROOFS: z.string().optional(),
    GCS_BUCKET_PUBLIC: z.string().optional(),

    GOTENBERG_URL: z.string().optional(),

    OPENAI_API_KEY: z.string().optional(),
    LLM_MODEL: z.string().optional(),
    PROMPT_VERSION: z.string().optional(),

    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_KEY_SECRET: z.string().optional(),
    RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

    WHATSAPP_BSP_API_KEY: z.string().optional(),
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
    WHATSAPP_VERIFY_TOKEN: z.string().optional(),
    WHATSAPP_APP_SECRET: z.string().optional(),

    BREVO_API_KEY: z.string().optional(),
    BREVO_LIST_ID: z.string().optional(),

    GIFTCARD_VENDOR: z.enum(["manual", "xoxoday", "qwikcilver"]).default("manual"),
    GIFTCARD_API_KEY: z.string().optional(),

    SESSION_COOKIE_SECRET: z.string().min(32, "SESSION_COOKIE_SECRET must be at least 32 characters"),
    SENTRY_DSN: z.string().optional(),
    ADMIN_IP_ALLOWLIST: z.string().optional(),
  })
  .refine((data) => !(data.NODE_ENV === "production" && data.DEV_LOGIN_ENABLED), {
    message: "DEV_LOGIN_ENABLED must not be true when NODE_ENV=production",
    path: ["DEV_LOGIN_ENABLED"],
  })
  .refine((data) => !(data.NODE_ENV === "production" && data.DEV_MAILBOX_PATH !== undefined), {
    message: "DEV_MAILBOX_PATH must not be set when NODE_ENV=production",
    path: ["DEV_MAILBOX_PATH"],
  });
```

The rest of `env.ts` (`Env` type, `cached`, `getEnv()`, `resetEnvCacheForTests()`) is unchanged — `getEnv()`'s existing `parsed.error.issues.map((i) => \`  ${i.path.join(".")}: ${i.message}\`)` already renders `refine` issues correctly, since they carry the same `path`/`message` shape as field-level issues.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run src/config/env.test.ts`
Expected: PASS, all tests in the file green.

- [ ] **Step 5: Commit**

```bash
git add src/config/env.ts src/config/env.test.ts
git commit -m "feat(env): add DEV_LOGIN_ENABLED and DEV_MAILBOX_PATH, refused in production"
```

---

## Task 2: Production-safe auth adapter selection

**Files:**
- Create: `src/adapters/auth/refusing.ts`
- Create: `src/adapters/auth/refusing.test.ts`
- Modify: `src/lib/adapters.impl.ts`
- Modify: `src/lib/adapters.test.ts`

**Interfaces:**
- Consumes: `AuthAdapter`, `InvalidTokenError` from `src/adapters/auth/types.ts` (unchanged).
- Produces: `createRefusingAuthAdapter(): { adapter: AuthAdapter }`. `getAdapters().auth` is the refusing adapter when `NODE_ENV === "production"`, else the existing fake adapter (unchanged from today for every non-production environment).

- [ ] **Step 1: Write the failing test for the new adapter**

Create `src/adapters/auth/refusing.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createRefusingAuthAdapter } from "./refusing";
import { InvalidTokenError } from "./types";

describe("createRefusingAuthAdapter", () => {
  it("rejects an arbitrary token", async () => {
    const { adapter } = createRefusingAuthAdapter();
    await expect(adapter.verifyIdToken("anything")).rejects.toThrow(InvalidTokenError);
  });

  it("rejects an otherwise well-formed fake token", async () => {
    const { adapter } = createRefusingAuthAdapter();
    const token = Buffer.from(JSON.stringify({ providerUid: "fb-1", email: "a@b.com" })).toString("base64url");
    await expect(adapter.verifyIdToken(token)).rejects.toThrow(InvalidTokenError);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run src/adapters/auth/refusing.test.ts`
Expected: FAIL — `./refusing` has no exported member `createRefusingAuthAdapter` (module not found).

- [ ] **Step 3: Implement the adapter**

Create `src/adapters/auth/refusing.ts`:

```ts
import type { AuthAdapter } from "./types";
import { InvalidTokenError } from "./types";

/**
 * Always rejects. Selected for NODE_ENV=production until a real Firebase
 * adapter exists, so a production deployment can never accept the fake
 * adapter's forged base64url tokens — independent of ADAPTERS,
 * DEV_LOGIN_ENABLED, or any route existing at all.
 */
export function createRefusingAuthAdapter(): { adapter: AuthAdapter } {
  return {
    adapter: {
      async verifyIdToken(_idToken: string): Promise<never> {
        throw new InvalidTokenError();
      },
    },
  };
}
```

- [ ] **Step 4: Run it and verify it passes**

Run: `npx vitest run src/adapters/auth/refusing.test.ts`
Expected: PASS, 2/2.

- [ ] **Step 5: Write the failing tests for adapter selection**

In `src/lib/adapters.test.ts`, replace the existing test:

```ts
  it("always uses fake auth, storage, and email regardless of ADAPTERS, since no real implementation exists yet", () => {
    process.env.ADAPTERS = "real";
    resetEnvCacheForTests();
    const adapters = getAdapters();
    expect(adapters.auth).toBeDefined();
    expect(adapters.storage).toBeDefined();
    expect(adapters.email).toBeDefined();
  });
```

with:

```ts
  it("always uses fake storage and email regardless of ADAPTERS, since no real implementation exists yet", () => {
    process.env.ADAPTERS = "real";
    resetEnvCacheForTests();
    const adapters = getAdapters();
    expect(adapters.storage).toBeDefined();
    expect(adapters.email).toBeDefined();
  });

  it("uses the fake auth adapter outside production, regardless of ADAPTERS", async () => {
    process.env.ADAPTERS = "real";
    resetEnvCacheForTests();
    const adapters = getAdapters();
    const token = Buffer.from(JSON.stringify({ providerUid: "fb-1", email: "a@b.com" })).toString("base64url");
    await expect(adapters.auth.verifyIdToken(token)).resolves.toEqual({ providerUid: "fb-1", email: "a@b.com" });
  });

  it("uses the fake auth adapter when NODE_ENV=test, not the production-refusing one", async () => {
    process.env.NODE_ENV = "test";
    resetEnvCacheForTests();
    const adapters = getAdapters();
    const token = Buffer.from(JSON.stringify({ providerUid: "fb-1", email: "a@b.com" })).toString("base64url");
    await expect(adapters.auth.verifyIdToken(token)).resolves.toEqual({ providerUid: "fb-1", email: "a@b.com" });
  });

  it("rejects every token in production, including an otherwise-valid fake token", async () => {
    process.env.NODE_ENV = "production";
    resetEnvCacheForTests();
    const adapters = getAdapters();
    const token = Buffer.from(JSON.stringify({ providerUid: "fb-1", email: "a@b.com" })).toString("base64url");
    await expect(adapters.auth.verifyIdToken(token)).rejects.toThrow(InvalidTokenError);
  });
```

Add the import at the top of `src/lib/adapters.test.ts`:

```ts
import { InvalidTokenError } from "../adapters/auth/types";
```

- [ ] **Step 6: Run and verify the new/changed tests fail**

Run: `npx vitest run src/lib/adapters.test.ts`
Expected: FAIL — the "rejects every token in production" test fails because `getAdapters().auth` is still the fake adapter, which accepts the token instead of throwing.

- [ ] **Step 7: Wire the selection into `adapters.impl.ts`**

In `src/lib/adapters.impl.ts`, add the import:

```ts
import { createRefusingAuthAdapter } from "../adapters/auth/refusing";
```

Change this line inside `getAdapters()`:

```ts
  const auth: AuthAdapter = createFakeAuthAdapter().adapter;
```

to:

```ts
  const auth: AuthAdapter =
    env.NODE_ENV === "production" ? createRefusingAuthAdapter().adapter : createFakeAuthAdapter().adapter;
```

Update the file's doc comment (the paragraph starting "auth/storage/email/whatsapp have no real.ts implementation yet") to note the one exception:

```ts
 * auth/storage/email/whatsapp have no real.ts implementation yet (Firebase, Cloud Storage,
 * and Brevo are deferred; WhatsAppGateway has only a fake in this plan) — they
 * always use fakes until those land, regardless of ADAPTERS, with one
 * exception: auth uses a refusing adapter (src/adapters/auth/refusing.ts)
 * whenever NODE_ENV=production, so a production deployment can never accept
 * the fake adapter's forged tokens even before a real Firebase adapter exists.
 * giftCards always uses the manual fulfilment vendor (the founder
```

(This replaces the sentence ending "...regardless of ADAPTERS. giftCards always uses..." — keep everything else in the comment as-is.)

- [ ] **Step 8: Run the full test file and verify it passes**

Run: `npx vitest run src/lib/adapters.test.ts`
Expected: PASS, all tests in the file green.

- [ ] **Step 9: Commit**

```bash
git add src/adapters/auth/refusing.ts src/adapters/auth/refusing.test.ts src/lib/adapters.impl.ts src/lib/adapters.test.ts
git commit -m "fix(auth): reject every token in production instead of accepting the fake adapter unconditionally"
```

---

## Task 3: DB layer — profile lookups by userId, idempotent seeker-profile creation, OTP invalidation

**Files:**
- Modify: `src/adapters/db/types.ts`
- Modify: `src/adapters/db/fake.ts`
- Modify: `src/adapters/db/real.ts`
- Modify: `src/adapters/db/fake.test.ts`
- Create: `src/adapters/db/real.live.test.ts`

**Interfaces:**
- Consumes: existing `Database.identity.*` methods, `seekerProfiles`/`insiderProfiles`/`workEmailOtps` Drizzle tables (unchanged), the `notifications.create` `onConflictDoNothing` pattern in `real.ts` as precedent.
- Produces (added to `Database["identity"]`):
  - `getSeekerProfileByUserId(userId: string): Promise<SeekerProfileRecord | null>`
  - `getInsiderProfileByUserId(userId: string): Promise<InsiderProfileRecord | null>`
  - `createOrGetSeekerProfile(userId: string, fullName: string): Promise<{ record: SeekerProfileRecord; created: boolean }>`
  - `storeWorkEmailOtp` (existing signature, changed behavior): invalidates every prior unconsumed OTP for the same `insiderProfileId` before inserting the new one.

- [ ] **Step 1: Write the failing tests (fake)**

Add these tests inside the existing `describe("createFakeDatabase identity", ...)` block in `src/adapters/db/fake.test.ts` (after the last existing `it` in that block, before its closing `});`):

```ts
  it("returns one profile even when both calls are issued via Promise.all (fake has no true concurrency; real.live.test.ts proves this under actual concurrent writes)", async () => {
    const { db } = createFakeDatabase();
    const user = await db.identity.findOrCreateUser("fb-race-1", "race1@x.com", "seeker");
    const [a, b] = await Promise.all([
      db.identity.createOrGetSeekerProfile(user.id, "Race A"),
      db.identity.createOrGetSeekerProfile(user.id, "Race B"),
    ]);
    expect(a.record.id).toBe(b.record.id);
  });

  it("createOrGetSeekerProfile is idempotent across sequential calls, reporting created only the first time", async () => {
    const { db } = createFakeDatabase();
    const user = await db.identity.findOrCreateUser("fb-idem-seeker", "idemseeker@x.com", "seeker");
    const first = await db.identity.createOrGetSeekerProfile(user.id, "First Call");
    const second = await db.identity.createOrGetSeekerProfile(user.id, "Second Call");
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.record.id).toBe(first.record.id);
    expect(second.record.fullName).toBe("First Call");
  });

  it("gets a seeker profile by userId, and returns null when none exists", async () => {
    const { db } = createFakeDatabase();
    const user = await db.identity.findOrCreateUser("fb-gsbu-1", "gsbu1@x.com", "seeker");
    expect(await db.identity.getSeekerProfileByUserId(user.id)).toBeNull();
    const created = await db.identity.createOrGetSeekerProfile(user.id, "Lookup Me");
    expect((await db.identity.getSeekerProfileByUserId(user.id))?.id).toBe(created.record.id);
  });

  it("gets an insider profile by userId, and returns null when none exists", async () => {
    const { db, seedCompany } = createFakeDatabase();
    const company = seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const user = await db.identity.findOrCreateUser("fb-gibu-1", "gibu1@acme.com", "seeker");
    expect(await db.identity.getInsiderProfileByUserId(user.id)).toBeNull();
    const created = await db.identity.findOrCreateInsiderProfile(user.id, company.id, "gibu1@acme.com");
    expect((await db.identity.getInsiderProfileByUserId(user.id))?.id).toBe(created.id);
  });

  it("storeWorkEmailOtp invalidates a prior unconsumed code for the same profile", async () => {
    const { db, seedCompany } = createFakeDatabase();
    const company = seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const user = await db.identity.findOrCreateUser("fb-inv-1", "inv1@acme.com", "insider");
    const profile = await db.identity.findOrCreateInsiderProfile(user.id, company.id, "inv1@acme.com");
    await db.identity.storeWorkEmailOtp(profile.id, "hash-old", new Date(Date.now() + 60_000));
    await db.identity.storeWorkEmailOtp(profile.id, "hash-new", new Date(Date.now() + 60_000));

    expect(await db.identity.consumeWorkEmailOtp(profile.id, "hash-old", new Date())).toBe(false);
    expect(await db.identity.consumeWorkEmailOtp(profile.id, "hash-new", new Date())).toBe(true);
  });

  it("storeWorkEmailOtp does not error when the only prior code was already consumed", async () => {
    const { db, seedCompany } = createFakeDatabase();
    const company = seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const user = await db.identity.findOrCreateUser("fb-inv-2", "inv2@acme.com", "insider");
    const profile = await db.identity.findOrCreateInsiderProfile(user.id, company.id, "inv2@acme.com");
    await db.identity.storeWorkEmailOtp(profile.id, "hash-a", new Date(Date.now() + 60_000));
    await db.identity.consumeWorkEmailOtp(profile.id, "hash-a", new Date());
    await db.identity.storeWorkEmailOtp(profile.id, "hash-b", new Date(Date.now() + 60_000));
    expect(await db.identity.consumeWorkEmailOtp(profile.id, "hash-b", new Date())).toBe(true);
  });
```

- [ ] **Step 2: Run and verify they fail**

Run: `npx vitest run src/adapters/db/fake.test.ts`
Expected: FAIL — `db.identity.createOrGetSeekerProfile`, `getSeekerProfileByUserId`, `getInsiderProfileByUserId` are not functions (methods don't exist yet); the OTP-invalidation tests fail because `consumeWorkEmailOtp(profile.id, "hash-old", ...)` still returns `true` (nothing invalidated it).

- [ ] **Step 3: Add the three method signatures to `types.ts`**

In `src/adapters/db/types.ts`, inside the `identity` block of the `Database` interface, add these three lines directly after the existing `getSeekerProfileById(seekerProfileId: string): Promise<SeekerProfileRecord | null>;` line:

```ts
    getSeekerProfileByUserId(userId: string): Promise<SeekerProfileRecord | null>;
    getInsiderProfileByUserId(userId: string): Promise<InsiderProfileRecord | null>;
    createOrGetSeekerProfile(userId: string, fullName: string): Promise<{ record: SeekerProfileRecord; created: boolean }>;
```

- [ ] **Step 4: Implement in the fake**

In `src/adapters/db/fake.ts`, inside the `identity` object, add these three methods directly after the existing `async getSeekerProfileById(seekerProfileId: string) { ... }` method:

```ts
      async getSeekerProfileByUserId(userId: string) {
        return seekerProfiles.find((p) => p.userId === userId) ?? null;
      },
      async getInsiderProfileByUserId(userId: string) {
        return insiderProfiles.find((p) => p.userId === userId) ?? null;
      },
      async createOrGetSeekerProfile(userId: string, fullName: string) {
        const existing = seekerProfiles.find((p) => p.userId === userId);
        if (existing) return { record: existing, created: false };
        const profile: SeekerProfileRecord = { id: genId(), userId, fullName };
        seekerProfiles.push(profile);
        return { record: profile, created: true };
      },
```

Change the existing `storeWorkEmailOtp` method in the same `identity` object from:

```ts
      async storeWorkEmailOtp(insiderProfileId: string, codeHash: string, expiresAt: Date) {
        otps.push({ insiderProfileId, codeHash, expiresAt, consumedAt: null });
      },
```

to:

```ts
      async storeWorkEmailOtp(insiderProfileId: string, codeHash: string, expiresAt: Date) {
        const invalidatedAt = new Date();
        for (const otp of otps) {
          if (otp.insiderProfileId === insiderProfileId && !otp.consumedAt) {
            otp.consumedAt = invalidatedAt;
          }
        }
        otps.push({ insiderProfileId, codeHash, expiresAt, consumedAt: null });
      },
```

- [ ] **Step 5: Run and verify the fake tests pass**

Run: `npx vitest run src/adapters/db/fake.test.ts`
Expected: PASS, all tests in the file green.

- [ ] **Step 6: Implement in the real adapter**

In `src/adapters/db/real.ts`, inside the `identity` object, add these three methods directly after the existing `async getSeekerProfileById(seekerProfileId) { ... }` method:

```ts
      async getSeekerProfileByUserId(userId) {
        const [row] = await db.select().from(seekerProfiles).where(eq(seekerProfiles.userId, userId));
        return (row as SeekerProfileRecord) ?? null;
      },
      async getInsiderProfileByUserId(userId) {
        const [row] = await db.select().from(insiderProfiles).where(eq(insiderProfiles.userId, userId));
        return (row as InsiderProfileRecord) ?? null;
      },
      async createOrGetSeekerProfile(userId, fullName) {
        const [inserted] = await db
          .insert(seekerProfiles)
          .values({ userId, fullName })
          .onConflictDoNothing({ target: seekerProfiles.userId })
          .returning();
        if (inserted) return { record: inserted as SeekerProfileRecord, created: true };
        const [existing] = await db.select().from(seekerProfiles).where(eq(seekerProfiles.userId, userId));
        if (!existing) {
          throw new Error(`Seeker profile for user ${userId} vanished after a conflict`);
        }
        return { record: existing as SeekerProfileRecord, created: false };
      },
```

Change the existing `storeWorkEmailOtp` method in the same `identity` object from:

```ts
      async storeWorkEmailOtp(insiderProfileId, codeHash, expiresAt) {
        await db.insert(workEmailOtps).values({ insiderProfileId, codeHash, expiresAt });
      },
```

to:

```ts
      async storeWorkEmailOtp(insiderProfileId, codeHash, expiresAt) {
        await db.transaction(async (tx) => {
          await tx
            .update(workEmailOtps)
            .set({ consumedAt: new Date() })
            .where(and(eq(workEmailOtps.insiderProfileId, insiderProfileId), isNull(workEmailOtps.consumedAt)));
          await tx.insert(workEmailOtps).values({ insiderProfileId, codeHash, expiresAt });
        });
      },
```

(`eq`, `and`, `isNull` are already imported at the top of `real.ts`; no import changes needed for this step.)

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Write the live test against real Postgres**

Create `src/adapters/db/real.live.test.ts`:

```ts
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
```

This file is picked up by the default `npm test` run but every test inside skips itself (`describe.skipIf(!live)`) unless `RUN_VENDOR_TESTS=1` is set, identical to the existing `rewards.live.test.ts` convention — it must show as **skipped**, not fail, in a normal run.

- [ ] **Step 9: Run the full suite and verify nothing broke**

Run: `npm test`
Expected: all previously-passing tests still pass; the new `real.live.test.ts` file's tests show as skipped (not failed, not run).

- [ ] **Step 10: Commit**

```bash
git add src/adapters/db/types.ts src/adapters/db/fake.ts src/adapters/db/real.ts src/adapters/db/fake.test.ts src/adapters/db/real.live.test.ts
git commit -m "feat(db): add userId profile lookups, idempotent seeker-profile creation, and OTP-resend invalidation"
```

---

## Task 4: Identity module — `CurrentUser`, `getCurrentUserFromDb`, `resolveLanding`, access guards

**Files:**
- Modify: `src/modules/identity/identity.ts`
- Modify: `src/modules/identity/identity.test.ts`

**Interfaces:**
- Consumes: `db.identity.getUserById`, `db.identity.getSeekerProfileByUserId`, `db.identity.getInsiderProfileByUserId` (Task 3). `Role` from `../../adapters/db/types` (already imported in `identity.ts`).
- Produces:
  - `export interface CurrentUser { userId: string; role: Role; seekerProfileId: string | null; insiderProfile: { id: string; verifiedAt: Date | null } | null; }`
  - `getCurrentUserFromDb(deps: { db: Database }, userId: string): Promise<CurrentUser | null>`
  - `resolveLanding(user: CurrentUser): "/admin" | "/onboard" | "/seeker/dashboard" | "/insider/dashboard"`
  - `canAccessAdmin(user: CurrentUser): boolean`
  - `canAccessSeekerApp(user: CurrentUser): boolean`
  - `canAccessInsiderApp(user: CurrentUser): boolean`

  `SessionUser` (existing) and `signInWithFirebaseToken` (existing) are untouched — `CurrentUser` is a separate, new type.

- [ ] **Step 1: Write the failing tests**

Add to `src/modules/identity/identity.test.ts`, after the last existing `describe` block (append at the end of the file):

```ts
describe("getCurrentUserFromDb", () => {
  it("returns null when the user doesn't exist", async () => {
    const { deps } = makeDeps();
    expect(await getCurrentUserFromDb(deps, "nonexistent")).toBeNull();
  });

  it("returns a CurrentUser with null profiles for a brand-new user", async () => {
    const { deps } = makeDeps();
    const user = await deps.db.identity.findOrCreateUser("fb-cu-1", "cu1@x.com", "seeker");
    expect(await getCurrentUserFromDb(deps, user.id)).toEqual({
      userId: user.id,
      role: "seeker",
      seekerProfileId: null,
      insiderProfile: null,
    });
  });

  it("includes the seeker profile id once one exists", async () => {
    const { deps } = makeDeps();
    const user = await deps.db.identity.findOrCreateUser("fb-cu-2", "cu2@x.com", "seeker");
    const { record } = await deps.db.identity.createOrGetSeekerProfile(user.id, "CU Two");
    const currentUser = await getCurrentUserFromDb(deps, user.id);
    expect(currentUser?.seekerProfileId).toBe(record.id);
  });

  it("includes the insider profile with verifiedAt once one exists", async () => {
    const { deps, seedCompany } = makeDeps();
    const company = seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const user = await deps.db.identity.findOrCreateUser("fb-cu-3", "cu3@acme.com", "seeker");
    const profile = await deps.db.identity.findOrCreateInsiderProfile(user.id, company.id, "cu3@acme.com");
    const currentUser = await getCurrentUserFromDb(deps, user.id);
    expect(currentUser?.insiderProfile).toEqual({ id: profile.id, verifiedAt: null });
  });
});

describe("resolveLanding", () => {
  const base = { userId: "u1", seekerProfileId: null, insiderProfile: null } as const;

  it("sends an admin to /admin regardless of profiles", () => {
    expect(resolveLanding({ ...base, role: "admin", seekerProfileId: "sp1" })).toBe("/admin");
  });

  it("sends a user with a Seeker profile to /seeker/dashboard", () => {
    expect(resolveLanding({ ...base, role: "seeker", seekerProfileId: "sp1" })).toBe("/seeker/dashboard");
  });

  it("sends a both-role user with a Seeker profile AND a verified Insider profile to /seeker/dashboard, not /insider/dashboard", () => {
    expect(
      resolveLanding({
        ...base,
        role: "both",
        seekerProfileId: "sp1",
        insiderProfile: { id: "ip1", verifiedAt: new Date() },
      })
    ).toBe("/seeker/dashboard");
  });

  it("sends a verified Insider with no Seeker profile to /insider/dashboard", () => {
    expect(
      resolveLanding({ ...base, role: "insider", insiderProfile: { id: "ip1", verifiedAt: new Date() } })
    ).toBe("/insider/dashboard");
  });

  it("sends an unverified Insider with no Seeker profile to /onboard", () => {
    expect(resolveLanding({ ...base, role: "insider", insiderProfile: { id: "ip1", verifiedAt: null } })).toBe(
      "/onboard"
    );
  });

  it("sends a user with no profiles at all to /onboard", () => {
    expect(resolveLanding({ ...base, role: "seeker" })).toBe("/onboard");
  });

  it("never traps a Seeker who abandoned adding the Insider role: a Seeker profile plus an unverified Insider profile still lands on /seeker/dashboard", () => {
    expect(
      resolveLanding({
        ...base,
        role: "both",
        seekerProfileId: "sp1",
        insiderProfile: { id: "ip1", verifiedAt: null },
      })
    ).toBe("/seeker/dashboard");
  });
});

describe("canAccessAdmin / canAccessSeekerApp / canAccessInsiderApp", () => {
  const base = { userId: "u1", seekerProfileId: null, insiderProfile: null } as const;

  it("canAccessAdmin is true only for role=admin", () => {
    expect(canAccessAdmin({ ...base, role: "admin" })).toBe(true);
    expect(canAccessAdmin({ ...base, role: "both" })).toBe(false);
    expect(canAccessAdmin({ ...base, role: "seeker" })).toBe(false);
  });

  it("canAccessSeekerApp is true iff a Seeker profile exists, regardless of role", () => {
    expect(canAccessSeekerApp({ ...base, role: "seeker", seekerProfileId: "sp1" })).toBe(true);
    expect(canAccessSeekerApp({ ...base, role: "both", seekerProfileId: "sp1" })).toBe(true);
    expect(canAccessSeekerApp({ ...base, role: "seeker" })).toBe(false);
    expect(canAccessSeekerApp({ ...base, role: "admin" })).toBe(false);
  });

  it("canAccessInsiderApp is true iff an Insider profile exists AND is verified", () => {
    expect(canAccessInsiderApp({ ...base, role: "insider", insiderProfile: { id: "ip1", verifiedAt: new Date() } })).toBe(
      true
    );
    expect(canAccessInsiderApp({ ...base, role: "insider", insiderProfile: { id: "ip1", verifiedAt: null } })).toBe(
      false
    );
    expect(canAccessInsiderApp({ ...base, role: "insider" })).toBe(false);
  });
});
```

Add these names to the existing `import { ... } from "./identity";` block at the top of the file:

```ts
  getCurrentUserFromDb,
  resolveLanding,
  canAccessAdmin,
  canAccessSeekerApp,
  canAccessInsiderApp,
```

- [ ] **Step 2: Run and verify the tests fail**

Run: `npx vitest run src/modules/identity/identity.test.ts`
Expected: FAIL — `getCurrentUserFromDb`, `resolveLanding`, `canAccessAdmin`, `canAccessSeekerApp`, `canAccessInsiderApp` are not exported by `./identity`.

- [ ] **Step 3: Implement**

In `src/modules/identity/identity.ts`, add after the existing `SessionUser` interface (before `export async function signInWithFirebaseToken`):

```ts
export interface CurrentUser {
  userId: string;
  role: Role;
  seekerProfileId: string | null;
  insiderProfile: { id: string; verifiedAt: Date | null } | null;
}
```

Add at the end of the file:

```ts
export async function getCurrentUserFromDb(deps: { db: Database }, userId: string): Promise<CurrentUser | null> {
  const user = await deps.db.identity.getUserById(userId);
  if (!user) return null;

  const [seekerProfile, insiderProfile] = await Promise.all([
    deps.db.identity.getSeekerProfileByUserId(userId),
    deps.db.identity.getInsiderProfileByUserId(userId),
  ]);

  return {
    userId: user.id,
    role: user.role,
    seekerProfileId: seekerProfile?.id ?? null,
    insiderProfile: insiderProfile ? { id: insiderProfile.id, verifiedAt: insiderProfile.verifiedAt } : null,
  };
}

export function resolveLanding(user: CurrentUser): "/admin" | "/onboard" | "/seeker/dashboard" | "/insider/dashboard" {
  if (user.role === "admin") return "/admin";
  if (user.seekerProfileId !== null) return "/seeker/dashboard";
  if (user.insiderProfile !== null && user.insiderProfile.verifiedAt !== null) return "/insider/dashboard";
  // An unverified (or absent) Insider profile with no Seeker profile both land here.
  return "/onboard";
}

export function canAccessAdmin(user: CurrentUser): boolean {
  return user.role === "admin";
}

export function canAccessSeekerApp(user: CurrentUser): boolean {
  return user.seekerProfileId !== null;
}

export function canAccessInsiderApp(user: CurrentUser): boolean {
  return user.insiderProfile !== null && user.insiderProfile.verifiedAt !== null;
}
```

- [ ] **Step 4: Run and verify the tests pass**

Run: `npx vitest run src/modules/identity/identity.test.ts`
Expected: PASS, all tests in the file green.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/modules/identity/identity.ts src/modules/identity/identity.test.ts
git commit -m "feat(identity): add CurrentUser, getCurrentUserFromDb, resolveLanding, and the three app-access guards"
```

---

## Task 5: Identity module — narrow OTP deps; add `createOrGetSeekerProfile`, `requestWorkEmailOtp`, `verifyWorkEmailOtpForUser`

**Files:**
- Modify: `src/modules/identity/identity.ts`
- Modify: `src/modules/identity/identity.test.ts`
- Modify: `src/modules/identity/schemas.ts`

**Interfaces:**
- Consumes: `db.identity.createOrGetSeekerProfile`, `db.identity.getInsiderProfileByUserId` (Task 3); `EmailSender` from `../../adapters/email/types`; `brand` from `../../config/brand`.
- Produces:
  - `startWorkEmailOtp(deps: Pick<IdentityDeps, "db">, ...)` and `verifyWorkEmailOtp(deps: Pick<IdentityDeps, "db">, ...)` — same names/behavior, narrower `deps` type. Every existing caller (both pass a full `IdentityDeps`) keeps compiling unchanged.
  - `createOrGetSeekerProfile(deps: Pick<IdentityDeps, "db">, userId: string, fullName: string): Promise<SeekerProfileRecord>`
  - `requestWorkEmailOtp(deps: Pick<IdentityDeps, "db"> & { email: EmailSender }, userId: string, workEmail: string): Promise<{ insiderProfileId: string }>`
  - `verifyWorkEmailOtpForUser(deps: Pick<IdentityDeps, "db">, userId: string, code: string): Promise<boolean>`
  - `createOrGetSeekerProfileInputSchema`, `requestWorkEmailOtpInputSchema`, `verifyWorkEmailOtpForUserInputSchema`, `devLoginInputSchema` in `schemas.ts`, for Plan B's server actions to import.

- [ ] **Step 1: Write the failing tests**

Add this import to the top of `src/modules/identity/identity.test.ts`:

```ts
import { createFakeEmailSender } from "../../adapters/email/fake";
```

Add these names to the existing `import { ... } from "./identity";` block:

```ts
  createOrGetSeekerProfile,
  requestWorkEmailOtp,
  verifyWorkEmailOtpForUser,
```

Add at the end of the file:

```ts
describe("createOrGetSeekerProfile (module wrapper)", () => {
  it("creates a profile and returns the same one on repeated calls", async () => {
    const { deps } = makeDeps();
    const user = await deps.db.identity.findOrCreateUser("fb-cogsp-1", "cogsp1@x.com", "seeker");
    const first = await createOrGetSeekerProfile(deps, user.id, "First Name");
    const second = await createOrGetSeekerProfile(deps, user.id, "Second Name");
    expect(second.id).toBe(first.id);
    expect(second.fullName).toBe("First Name");
  });
});

describe("requestWorkEmailOtp", () => {
  it("sends an email containing a 6-digit code and the brand name in the subject", async () => {
    const { deps, seedCompany } = makeDeps();
    seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const { sender, sent } = createFakeEmailSender();

    await requestWorkEmailOtp({ db: deps.db, email: sender }, "user-1", "person@acme.com");

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("person@acme.com");
    expect(sent[0].subject).toContain("GetNudgd");
    expect(sent[0].html).toMatch(/\d{6}/);
  });

  it("never returns the code itself, only the insiderProfileId", async () => {
    const { deps, seedCompany } = makeDeps();
    seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const { sender } = createFakeEmailSender();

    const result = await requestWorkEmailOtp({ db: deps.db, email: sender }, "user-1", "person@acme.com");
    expect(Object.keys(result)).toEqual(["insiderProfileId"]);
  });

  it("invalidates the first email's OTP when called again with a different work email", async () => {
    const { deps, seedCompany } = makeDeps();
    seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    seedCompany({ name: "Beta", tier: "tier2" }, ["beta.com"]);
    const { sender, sent } = createFakeEmailSender();

    await requestWorkEmailOtp({ db: deps.db, email: sender }, "user-1", "person@acme.com");
    const firstCode = sent[0].html.match(/\d{6}/)?.[0];
    await requestWorkEmailOtp({ db: deps.db, email: sender }, "user-1", "person@beta.com");
    const secondCode = sent[1].html.match(/\d{6}/)?.[0];

    expect(await verifyWorkEmailOtpForUser({ db: deps.db }, "user-1", firstCode!)).toBe(false);
    expect(await verifyWorkEmailOtpForUser({ db: deps.db }, "user-1", secondCode!)).toBe(true);
  });
});

describe("verifyWorkEmailOtpForUser", () => {
  it("verifies using the caller's own userId, never a caller-supplied profile id", async () => {
    const { deps, seedCompany } = makeDeps();
    seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const { sender, sent } = createFakeEmailSender();

    await requestWorkEmailOtp({ db: deps.db, email: sender }, "user-1", "person@acme.com");
    const code = sent[0].html.match(/\d{6}/)?.[0]!;

    expect(await verifyWorkEmailOtpForUser({ db: deps.db }, "user-1", code)).toBe(true);
  });

  it("returns false when the user has no Insider profile at all", async () => {
    const { deps } = makeDeps();
    expect(await verifyWorkEmailOtpForUser({ db: deps.db }, "user-with-no-profile", "000000")).toBe(false);
  });

  it("returns false for a wrong code", async () => {
    const { deps, seedCompany } = makeDeps();
    seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const { sender } = createFakeEmailSender();

    await requestWorkEmailOtp({ db: deps.db, email: sender }, "user-1", "person@acme.com");
    expect(await verifyWorkEmailOtpForUser({ db: deps.db }, "user-1", "000000")).toBe(false);
  });
});
```

- [ ] **Step 2: Run and verify the tests fail**

Run: `npx vitest run src/modules/identity/identity.test.ts`
Expected: FAIL — `createOrGetSeekerProfile`, `requestWorkEmailOtp`, `verifyWorkEmailOtpForUser` are not exported by `./identity`.

- [ ] **Step 3: Narrow `startWorkEmailOtp` and `verifyWorkEmailOtp`, and add the three new functions**

In `src/modules/identity/identity.ts`, change the signature of the existing `startWorkEmailOtp` from:

```ts
export async function startWorkEmailOtp(
  deps: IdentityDeps,
  userId: string,
  workEmail: string
): Promise<StartWorkEmailOtpResult> {
```

to:

```ts
export async function startWorkEmailOtp(
  deps: Pick<IdentityDeps, "db">,
  userId: string,
  workEmail: string
): Promise<StartWorkEmailOtpResult> {
```

Change the signature of the existing `verifyWorkEmailOtp` from:

```ts
export async function verifyWorkEmailOtp(deps: IdentityDeps, insiderProfileId: string, code: string): Promise<boolean> {
```

to:

```ts
export async function verifyWorkEmailOtp(deps: Pick<IdentityDeps, "db">, insiderProfileId: string, code: string): Promise<boolean> {
```

Neither function body reads `deps.auth` — no other change to either function is needed.

Add these two new imports at the top of the file:

```ts
import type { EmailSender } from "../../adapters/email/types";
import { brand } from "../../config/brand";
```

Also change the existing `import type { Database, Role } from "../../adapters/db/types";` line to add `SeekerProfileRecord`:

```ts
import type { Database, Role, SeekerProfileRecord } from "../../adapters/db/types";
```

Add at the end of the file:

```ts
export async function createOrGetSeekerProfile(
  deps: Pick<IdentityDeps, "db">,
  userId: string,
  fullName: string
): Promise<SeekerProfileRecord> {
  const { record } = await deps.db.identity.createOrGetSeekerProfile(userId, fullName);
  return record;
}

export async function requestWorkEmailOtp(
  deps: Pick<IdentityDeps, "db"> & { email: EmailSender },
  userId: string,
  workEmail: string
): Promise<{ insiderProfileId: string }> {
  const { insiderProfileId, code } = await startWorkEmailOtp(deps, userId, workEmail);
  await deps.email.send({
    to: workEmail,
    subject: `Your ${brand.name} work-email code`,
    html: `<p>Your verification code is <strong>${code}</strong>. It expires in 10 minutes.</p>`,
  });
  return { insiderProfileId };
}

export async function verifyWorkEmailOtpForUser(
  deps: Pick<IdentityDeps, "db">,
  userId: string,
  code: string
): Promise<boolean> {
  const profile = await deps.db.identity.getInsiderProfileByUserId(userId);
  if (!profile) return false;
  return verifyWorkEmailOtp(deps, profile.id, code);
}
```

- [ ] **Step 4: Run and verify the tests pass**

Run: `npx vitest run src/modules/identity/identity.test.ts`
Expected: PASS, all tests in the file green.

- [ ] **Step 5: Add the shared input schemas for Plan B**

In `src/modules/identity/schemas.ts`, add at the end of the file:

```ts
export const createOrGetSeekerProfileInputSchema = z.object({
  fullName: z.string().min(1),
});

export const requestWorkEmailOtpInputSchema = z.object({
  fullName: z.string().min(1),
  workEmail: z.string().email(),
});

export const verifyWorkEmailOtpForUserInputSchema = z.object({
  code: z.string().length(6),
});

export const devLoginInputSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
});
```

(These validate raw form input before a server action calls the module; `userId` is never part of any of them — it always comes from the authenticated session, never from client input.)

- [ ] **Step 6: Typecheck the whole project**

Run: `npm run typecheck`
Expected: no errors. This step specifically proves the two narrowed signatures don't break any existing caller (there are none outside `identity.ts`/`identity.test.ts`, confirmed by a repo-wide search before this plan was written, but typecheck is the real proof).

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: all tests pass (no regressions from the signature narrowing).

- [ ] **Step 8: Commit**

```bash
git add src/modules/identity/identity.ts src/modules/identity/identity.test.ts src/modules/identity/schemas.ts
git commit -m "feat(identity): add createOrGetSeekerProfile, requestWorkEmailOtp, verifyWorkEmailOtpForUser, and narrow OTP deps to {db}"
```

---

## Task 6: Session freshness — `src/lib/current-user.ts`, `authorize()` widening

**Files:**
- Create: `src/lib/current-user.ts`
- Create: `src/lib/current-user.test.ts`
- Modify: `src/lib/authorize.ts`
- Modify: `src/lib/authorize.test.ts`

**Interfaces:**
- Consumes: `getSessionFromCookies` from `./session` (unchanged); `getCurrentUserFromDb`, `type CurrentUser` from `../modules/identity/identity` (Task 4); `getAdapters` from `./adapters`.
- Produces: `getCurrentUser(): Promise<CurrentUser | null>`. `authorize()`'s first parameter type widens from `SessionPayload | null` to `Pick<SessionPayload, "userId" | "role"> | null`.

- [ ] **Step 1: Write the failing tests for `current-user.ts`**

Create `src/lib/current-user.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getSessionFromCookiesMock = vi.fn();
vi.mock("./session", () => ({
  getSessionFromCookies: () => getSessionFromCookiesMock(),
}));

import { getCurrentUser } from "./current-user";
import { getAdapters, resetAdaptersCacheForTests } from "./adapters";
import { resetEnvCacheForTests } from "../config/env";

const REQUIRED_ENV = {
  APP_URL: "http://localhost:3000",
  BRAND_NAME: "GetNudgd",
  BRAND_DOMAIN: "getnudgd.com",
  DATABASE_URL: "postgres://getnudgd:getnudgd@localhost:5432/getnudgd",
  SESSION_COOKIE_SECRET: "a-test-secret-that-is-at-least-32-characters-long",
};

describe("getCurrentUser", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetEnvCacheForTests();
    resetAdaptersCacheForTests();
    process.env = { ...originalEnv, NODE_ENV: "development", ...REQUIRED_ENV };
    getSessionFromCookiesMock.mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetEnvCacheForTests();
    resetAdaptersCacheForTests();
  });

  it("returns null when there is no session cookie", async () => {
    getSessionFromCookiesMock.mockResolvedValue(null);
    expect(await getCurrentUser()).toBeNull();
  });

  it("returns the current user derived from the session's userId", async () => {
    const { db } = getAdapters();
    const user = await db.identity.findOrCreateUser("fb-cu-session-1", "cusession1@x.com", "seeker");
    getSessionFromCookiesMock.mockResolvedValue({ userId: user.id, role: "seeker", issuedAt: Date.now() });

    expect(await getCurrentUser()).toEqual({
      userId: user.id,
      role: "seeker",
      seekerProfileId: null,
      insiderProfile: null,
    });
  });

  it("returns null when the session points to a user that no longer exists", async () => {
    getSessionFromCookiesMock.mockResolvedValue({ userId: "deleted-user", role: "seeker", issuedAt: Date.now() });
    expect(await getCurrentUser()).toBeNull();
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx vitest run src/lib/current-user.test.ts`
Expected: FAIL — `./current-user` module not found.

- [ ] **Step 3: Implement**

Create `src/lib/current-user.ts`:

```ts
import { cache } from "react";
import "server-only";
import { getSessionFromCookies } from "./session";
import { getCurrentUserFromDb, type CurrentUser } from "../modules/identity/identity";
import { getAdapters } from "./adapters";

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await getSessionFromCookies();
  if (!session) return null;
  const { db } = getAdapters();
  return getCurrentUserFromDb({ db }, session.userId);
});
```

- [ ] **Step 4: Run and verify it passes**

Run: `npx vitest run src/lib/current-user.test.ts`
Expected: PASS, 3/3.

- [ ] **Step 5: Write the failing test for `authorize()`'s widened type**

Add to `src/lib/authorize.test.ts`, before the closing `});` of the `describe("authorize", ...)` block:

```ts
  it("accepts a narrower { userId, role } shape sourced from a CurrentUser, without issuedAt", () => {
    expect(authorize({ userId: "u1", role: "seeker" }, "read", { type: "seekerProfile", ownerUserId: "u1" })).toBe(
      true
    );
  });
```

- [ ] **Step 6: Run typecheck and verify it fails**

`authorize()`'s runtime body already only reads `.role`/`.userId`, so this new test's *assertion* would pass under Vitest's esbuild transform even before the signature changes — esbuild strips types without checking them, so Vitest alone cannot prove this step's RED. The actual constraint this test proves is a type-level one, so the authoritative check here is `tsc`, not `vitest`.

Run: `npm run typecheck`
Expected: FAIL — `src/lib/authorize.test.ts` reports the object literal `{ userId: "u1", role: "seeker" }` is not assignable to `SessionPayload | null` (missing the required `issuedAt` property).

- [ ] **Step 7: Widen `authorize()`'s signature**

In `src/lib/authorize.ts`, change:

```ts
export function authorize(session: SessionPayload | null, _action: Action, resource: Resource): boolean {
```

to:

```ts
export function authorize(session: Pick<SessionPayload, "userId" | "role"> | null, _action: Action, resource: Resource): boolean {
```

No other line in the file changes — the body already only reads `session.role` and `session.userId`.

- [ ] **Step 8: Run typecheck and the tests, verify both pass**

Run: `npm run typecheck && npx vitest run src/lib/authorize.test.ts`
Expected: typecheck clean; all tests in the file PASS (including every pre-existing test, which passed at the JS level throughout this task since none of their inputs ever changed shape).

- [ ] **Step 9: Commit**

```bash
git add src/lib/current-user.ts src/lib/current-user.test.ts src/lib/authorize.ts src/lib/authorize.test.ts
git commit -m "feat(auth): add getCurrentUser() session-freshness helper, widen authorize()'s session parameter type"
```

---

## Task 7: `src/lib/problems.ts`

**Files:**
- Create: `src/lib/problems.ts`
- Create: `src/lib/problems.test.ts`

**Interfaces:**
- Consumes: `WorkEmailDomainError`, `InsiderCompanyChangeError` from `../modules/identity/identity` (existing); `InvalidTokenError` from `../adapters/auth/types` (existing); `ZodError` from `zod`.
- Produces: `type ProblemType`, `interface Problem`, `problem(type: ProblemType): Problem`, `mapErrorToProblem(err: unknown): Problem`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/problems.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { z, ZodError } from "zod";
import { problem, mapErrorToProblem } from "./problems";
import { WorkEmailDomainError, InsiderCompanyChangeError } from "../modules/identity/identity";
import { InvalidTokenError } from "../adapters/auth/types";

describe("problem", () => {
  it("returns the type with a non-empty human title, for every ProblemType", () => {
    const types = [
      "work-email-domain-not-registered",
      "insider-company-change-not-allowed",
      "otp-invalid-or-expired",
      "auth-invalid-token",
      "dev-login-wrong-code",
      "rate-limited",
      "validation-failed",
      "unexpected",
    ] as const;
    for (const type of types) {
      const p = problem(type);
      expect(p.type).toBe(type);
      expect(p.title.length).toBeGreaterThan(0);
    }
  });
});

describe("mapErrorToProblem", () => {
  it("maps a ZodError to validation-failed", () => {
    let caught: unknown;
    try {
      z.object({ x: z.string() }).parse({});
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ZodError);
    expect(mapErrorToProblem(caught).type).toBe("validation-failed");
  });

  it("maps WorkEmailDomainError to work-email-domain-not-registered", () => {
    expect(mapErrorToProblem(new WorkEmailDomainError("nope.com")).type).toBe("work-email-domain-not-registered");
  });

  it("maps InsiderCompanyChangeError to insider-company-change-not-allowed", () => {
    expect(mapErrorToProblem(new InsiderCompanyChangeError()).type).toBe("insider-company-change-not-allowed");
  });

  it("maps InvalidTokenError to auth-invalid-token", () => {
    expect(mapErrorToProblem(new InvalidTokenError()).type).toBe("auth-invalid-token");
  });

  it("falls back to unexpected for an unrecognized Error", () => {
    expect(mapErrorToProblem(new Error("boom")).type).toBe("unexpected");
  });

  it("falls back to unexpected for a non-Error thrown string", () => {
    expect(mapErrorToProblem("boom").type).toBe("unexpected");
  });

  it("falls back to unexpected for a non-Error object with a message field, without throwing", () => {
    expect(() => mapErrorToProblem({ message: "looks like an error but isn't" })).not.toThrow();
    expect(mapErrorToProblem({ message: "looks like an error but isn't" }).type).toBe("unexpected");
  });

  it("never renders a thrown error's own .message as the title", () => {
    const p = mapErrorToProblem(new Error("some vendor-internal stack trace detail"));
    expect(p.title).not.toContain("vendor-internal stack trace detail");
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx vitest run src/lib/problems.test.ts`
Expected: FAIL — `./problems` module not found.

- [ ] **Step 3: Implement**

Create `src/lib/problems.ts`:

```ts
import { ZodError } from "zod";
import { WorkEmailDomainError, InsiderCompanyChangeError } from "../modules/identity/identity";
import { InvalidTokenError } from "../adapters/auth/types";

export type ProblemType =
  | "work-email-domain-not-registered"
  | "insider-company-change-not-allowed"
  | "otp-invalid-or-expired"
  | "auth-invalid-token"
  | "dev-login-wrong-code"
  | "rate-limited"
  | "validation-failed"
  | "unexpected";

export interface Problem {
  type: ProblemType;
  title: string;
}

const TITLES: Record<ProblemType, string> = {
  "work-email-domain-not-registered": "We don't recognize that work email's domain yet.",
  "insider-company-change-not-allowed": "You're already verified with a different company — contact support to change it.",
  "otp-invalid-or-expired": "That code is wrong or has expired. Try again or request a new one.",
  "auth-invalid-token": "Your sign-in link is invalid or has expired.",
  "dev-login-wrong-code": "That code is wrong.",
  "rate-limited": "Too many attempts — please wait a bit and try again.",
  "validation-failed": "Please check the highlighted fields and try again.",
  unexpected: "Something went wrong. Please try again.",
};

/** For a known, named condition that isn't a thrown JS error (e.g. a boolean check that returned false). */
export function problem(type: ProblemType): Problem {
  return { type, title: TITLES[type] };
}

/** For a genuinely caught exception. Never renders the error's own .message — copy comes only from TITLES. */
export function mapErrorToProblem(err: unknown): Problem {
  if (err instanceof ZodError) return problem("validation-failed");
  if (err instanceof WorkEmailDomainError) return problem("work-email-domain-not-registered");
  if (err instanceof InsiderCompanyChangeError) return problem("insider-company-change-not-allowed");
  if (err instanceof InvalidTokenError) return problem("auth-invalid-token");
  return problem("unexpected");
}
```

- [ ] **Step 4: Run and verify it passes**

Run: `npx vitest run src/lib/problems.test.ts`
Expected: PASS, all tests in the file green.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/problems.ts src/lib/problems.test.ts
git commit -m "feat(lib): add problems.ts, the RFC 7807-style problem-details helper"
```

---

## Task 8: `src/lib/limiters.ts`

**Files:**
- Create: `src/lib/limiters.ts`
- Create: `src/lib/limiters.test.ts`

**Interfaces:**
- Consumes: `createInMemoryRateLimiter`, `type RateLimiter` from `./ratelimit` (unchanged).
- Produces: `devLoginLimiter`, `otpSendLimiter`, `otpVerifyLimiter` (each a `RateLimiter`), `limiterKey(userId: string | null, headers: Headers): string`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/limiters.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { devLoginLimiter, otpSendLimiter, otpVerifyLimiter, limiterKey } from "./limiters";

describe("rate limiters", () => {
  it("devLoginLimiter allows 5 attempts then denies the 6th", () => {
    const key = "dev-login-k1";
    for (let i = 0; i < 5; i++) expect(devLoginLimiter.check(key)).toBe(true);
    expect(devLoginLimiter.check(key)).toBe(false);
  });

  it("otpSendLimiter allows 3 attempts then denies the 4th", () => {
    const key = "otp-send-k1";
    for (let i = 0; i < 3; i++) expect(otpSendLimiter.check(key)).toBe(true);
    expect(otpSendLimiter.check(key)).toBe(false);
  });

  it("otpVerifyLimiter allows 5 attempts then denies the 6th", () => {
    const key = "otp-verify-k1";
    for (let i = 0; i < 5; i++) expect(otpVerifyLimiter.check(key)).toBe(true);
    expect(otpVerifyLimiter.check(key)).toBe(false);
  });
});

describe("limiterKey", () => {
  it("keys different users independently even behind the same IP", () => {
    const headers = new Headers({ "x-forwarded-for": "1.1.1.1" });
    expect(limiterKey("user-a", headers)).not.toBe(limiterKey("user-b", headers));
  });

  it("takes the first entry of a comma-separated x-forwarded-for chain", () => {
    const headers = new Headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" });
    expect(limiterKey("u1", headers)).toBe("u1:9.9.9.9");
  });

  it("falls back to \"unknown\" when x-forwarded-for is absent", () => {
    expect(limiterKey(null, new Headers())).toBe("anon:unknown");
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx vitest run src/lib/limiters.test.ts`
Expected: FAIL — `./limiters` module not found.

- [ ] **Step 3: Implement**

Create `src/lib/limiters.ts`:

```ts
import { createInMemoryRateLimiter } from "./ratelimit";

export const devLoginLimiter = createInMemoryRateLimiter(5, 60_000); // 5 attempts / minute
export const otpSendLimiter = createInMemoryRateLimiter(3, 5 * 60_000); // 3 sends / 5 minutes
export const otpVerifyLimiter = createInMemoryRateLimiter(5, 5 * 60_000); // 5 attempts / 5 minutes

export function limiterKey(userId: string | null, headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for");
  const ip = forwardedFor?.split(",")[0]?.trim() ?? "unknown"; // Caddy sets this in prod; "unknown" is a shared bucket for local dev/test
  return `${userId ?? "anon"}:${ip}`;
}
```

- [ ] **Step 4: Run and verify it passes**

Run: `npx vitest run src/lib/limiters.test.ts`
Expected: PASS, all tests in the file green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/limiters.ts src/lib/limiters.test.ts
git commit -m "feat(lib): add named rate limiters and limiterKey for /login and /onboard"
```

---

## Task 9: Dev mailbox for the Insider OTP email

**Files:**
- Create: `src/adapters/email/file-mailbox.ts`
- Create: `src/adapters/email/file-mailbox.test.ts`
- Modify: `src/lib/adapters.impl.ts`
- Modify: `src/lib/adapters.test.ts`

**Interfaces:**
- Consumes: `createFakeEmailSender`, `type EmailSender`, `type EmailMessage` from `./fake`/`./types` (unchanged); `Env.DEV_MAILBOX_PATH` (Task 1).
- Produces: `createFileMailboxEmailSender(filePath: string): { sender: EmailSender }`. `getAdapters().email` is the file-mailbox sender when `NODE_ENV !== "production"` and `DEV_MAILBOX_PATH` is set, else the plain fake (unchanged default).

- [ ] **Step 1: Write the failing tests for the new adapter**

Create `src/adapters/email/file-mailbox.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFileMailboxEmailSender } from "./file-mailbox";

describe("createFileMailboxEmailSender", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("creates the file if it doesn't exist yet", () => {
    dir = mkdtempSync(path.join(tmpdir(), "gn-mailbox-"));
    const filePath = path.join(dir, "mailbox.jsonl");
    createFileMailboxEmailSender(filePath);
    expect(readFileSync(filePath, "utf8")).toBe("");
  });

  it("appends each sent message as a JSON line with to/subject/html/sentAt", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "gn-mailbox-"));
    const filePath = path.join(dir, "mailbox.jsonl");
    const { sender } = createFileMailboxEmailSender(filePath);

    await sender.send({ to: "a@b.com", subject: "Hi", html: "<p>Code: 123456</p>" });
    await sender.send({ to: "c@d.com", subject: "Hi 2", html: "<p>Code: 654321</p>" });

    const lines = readFileSync(filePath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]);
    expect(first).toMatchObject({ to: "a@b.com", subject: "Hi", html: "<p>Code: 123456</p>" });
    expect(typeof first.sentAt).toBe("string");
  });

  it("never logs the message to the console", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "gn-mailbox-"));
    const filePath = path.join(dir, "mailbox.jsonl");
    const { sender } = createFileMailboxEmailSender(filePath);
    const logSpy = vi.spyOn(console, "log");
    await sender.send({ to: "a@b.com", subject: "Hi", html: "<p>Code: 123456</p>" });
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });
});
```

Add `vi` to the vitest import at the top of the file: `import { describe, it, expect, afterEach, vi } from "vitest";`

- [ ] **Step 2: Run and verify it fails**

Run: `npx vitest run src/adapters/email/file-mailbox.test.ts`
Expected: FAIL — `./file-mailbox` module not found.

- [ ] **Step 3: Implement**

Create `src/adapters/email/file-mailbox.ts`:

```ts
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { createFakeEmailSender } from "./fake";
import type { EmailSender } from "./types";

/**
 * Wraps createFakeEmailSender: same in-memory behavior, plus every sent
 * message is appended to filePath as one JSON line, for a separate process
 * (Playwright) to read. Never logged to the console — OTP codes are
 * secret-shaped data.
 */
export function createFileMailboxEmailSender(filePath: string): { sender: EmailSender } {
  const { sender: fakeSender } = createFakeEmailSender();
  if (!existsSync(filePath)) writeFileSync(filePath, "");

  const sender: EmailSender = {
    async send(message) {
      const result = await fakeSender.send(message);
      const line = JSON.stringify({ ...message, sentAt: new Date().toISOString() });
      appendFileSync(filePath, line + "\n");
      return result;
    },
  };
  return { sender };
}
```

- [ ] **Step 4: Run and verify it passes**

Run: `npx vitest run src/adapters/email/file-mailbox.test.ts`
Expected: PASS, all tests in the file green.

- [ ] **Step 5: Write the failing tests for email-adapter selection**

Add to `src/lib/adapters.test.ts`, at the end of the `describe("getAdapters", ...)` block (before its closing `});`):

```ts
  it("uses the file mailbox sender when DEV_MAILBOX_PATH is set outside production", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "gn-mailbox-adapters-"));
    const filePath = path.join(dir, "mailbox.jsonl");
    process.env.DEV_MAILBOX_PATH = filePath;
    resetEnvCacheForTests();
    const adapters = getAdapters();
    await adapters.email.send({ to: "a@b.com", subject: "Hi", html: "<p>hi</p>" });
    expect(readFileSync(filePath, "utf8")).toContain("a@b.com");
    rmSync(dir, { recursive: true, force: true });
  });

  it("uses the plain fake sender when DEV_MAILBOX_PATH is unset", async () => {
    const adapters = getAdapters();
    const result = await adapters.email.send({ to: "a@b.com", subject: "Hi", html: "<p>hi</p>" });
    expect(result.id).toMatch(/^fake-email-/);
  });
```

Add these imports at the top of `src/lib/adapters.test.ts`:

```ts
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
```

- [ ] **Step 6: Run and verify the new test fails**

Run: `npx vitest run src/lib/adapters.test.ts`
Expected: FAIL — "uses the file mailbox sender..." fails because `getAdapters().email` is still the plain fake, so the mailbox file stays empty.

- [ ] **Step 7: Wire the selection into `adapters.impl.ts`**

In `src/lib/adapters.impl.ts`, add the import:

```ts
import { createFileMailboxEmailSender } from "../adapters/email/file-mailbox";
```

Change this line inside `getAdapters()`:

```ts
  const email: EmailSender = createFakeEmailSender().sender;
```

to:

```ts
  const email: EmailSender =
    env.NODE_ENV !== "production" && env.DEV_MAILBOX_PATH
      ? createFileMailboxEmailSender(env.DEV_MAILBOX_PATH).sender
      : createFakeEmailSender().sender;
```

- [ ] **Step 8: Run and verify the tests pass**

Run: `npx vitest run src/lib/adapters.test.ts`
Expected: PASS, all tests in the file green.

- [ ] **Step 9: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: all green, no type errors.

- [ ] **Step 10: Commit**

```bash
git add src/adapters/email/file-mailbox.ts src/adapters/email/file-mailbox.test.ts src/lib/adapters.impl.ts src/lib/adapters.test.ts
git commit -m "feat(email): add a file-backed dev mailbox for the Insider OTP email, opt-in via DEV_MAILBOX_PATH"
```

---

## Completion

After Task 9, Plan A is done: `getEnv()` refuses dev-only flags in production, the auth adapter refuses every token in production, and Plan B has everything it needs — `getCurrentUser()`, `resolveLanding()`, the three `canAccess*` guards, `createOrGetSeekerProfile`/`requestWorkEmailOtp`/`verifyWorkEmailOtpForUser`, `problem()`/`mapErrorToProblem()`, the three named rate limiters, and the dev mailbox — to build `/login`, `/onboard`, and the three guarded layouts without writing any decision logic of its own.

Run `npm run lint && npm run typecheck && npm test` once more before handing off to Plan B, and paste the output in the final report.
