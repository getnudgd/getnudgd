# Phase 1 Insiders & Resumes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three prerequisite gaps the Phase 1 Identity Foundation plan's final review flagged (role promotion, `authorize()`'s missing owner-resolution primitive, non-idempotent OTP-triggered profile creation), then build the `resumes` module (upload registration) and the `insiders` module (search, detail, availability) — the next two items in AGENTS.md §3.11's Phase 1 backend backlog.

**Architecture:** Same layering as Phase 0/Phase 1 Identity: `Database` gains two more sub-interfaces (`resumes`, `insiders`), each with a fake (used by all tests) and a real Drizzle-backed implementation. `src/modules/resumes` and `src/modules/insiders` are pure domain modules taking a `deps` object, following AGENTS.md Part 2.2 exactly like `identity`/`ledger`/`config` before them. File uploads themselves go straight from the browser to Cloud Storage using the signed URL already available from Phase 0's `StorageAdapter` (`createSignedUploadUrl`); this plan's `resumes` module only registers the resulting object as a database row after the browser-side upload completes — it never touches file bytes.

**Tech Stack:** Drizzle ORM, Zod — both already in use, no additions.

**Spec:** `AGENTS.md` at the repo root — specifically §1.4 (data model), Part 2 (shared rules), §3.2 (`insiders`/`resumes` module rows), §3.6 (`authorize()`), §3.7 (migrations). Also `.superpowers/sdd/2026-09-19-phase-1-identity-foundation-plan/progress.md`'s "Whole-branch final review" section (from the just-merged Phase 1 Identity Foundation plan) for the exact wording of the three prerequisite findings this plan opens with. No separate design doc: AGENTS.md already specifies this scope, and the three prerequisite fixes were already scoped and prioritized by that prior plan's final review.

## Global Constraints

- TypeScript strict, no `any`, no `@ts-ignore`; Zod at every boundary (AGENTS.md Part 2.1).
- Domain modules (`src/modules/resumes`, `src/modules/insiders`) import no Next.js, no Drizzle, no vendor SDK — only `Database` via a `deps` object (Part 2.2).
- Every vendor is behind an interface with a fake (Part 2.3) — `resumes`/`insiders` extend the existing `Database` fake/real pattern, no new vendor.
- Files never pass through the app server; uploads use signed URLs issued only after `authorize()` (Part 2.8) — this plan's `registerUpload` runs *after* the browser has already uploaded directly to Cloud Storage using a signed URL from the existing `StorageAdapter`; it never reads file bytes itself.
- One authorization chokepoint: `authorize(session, action, resource)` in `src/lib/authorize.ts` (§3.6) — this plan widens its `ResourceType` union, never adds a second chokepoint.
- Business numbers (credit cost per tier) are configuration, never literals (§0.5) — `insiders.getInsider`/`listInsiders` read `requestCostByTier` from the existing `config` module, never hardcode a cost.
- Small, verified commits with `type(scope): summary` messages; run `npm run lint && npm run typecheck && npm test` before every commit (Part 2.10). This plan executes on a task branch off `main`.
- Do not add dependencies without a stated reason (Part 2.11) — this plan adds none.
- Locked vocabulary: Insider, Seeker, never "referrer"/"job seeker" as an identifier (§0.4).
- No Postgres/Docker is available in this environment — `real.ts` additions must typecheck but cannot be executed against a live database here; this is expected, not a blocker, matching every prior plan.

---

## Task 1: Idempotent insider-profile creation (prerequisite fix)

**Files:**
- Modify: `src/adapters/db/types.ts`
- Modify: `src/adapters/db/fake.ts`
- Modify: `src/adapters/db/fake.test.ts`
- Modify: `src/adapters/db/real.ts`
- Modify: `src/modules/identity/identity.ts`

**Interfaces:**
- Produces: `Database.identity.findOrCreateInsiderProfile(userId, companyId, workEmail): Promise<InsiderProfileRecord>` — replaces the old `createInsiderProfile` (same three arguments, same return type, different semantics: idempotent per `userId`). Consumed by `src/modules/identity/identity.ts`'s `startWorkEmailOtp`.

This is the third prerequisite finding from the Phase 1 Identity Foundation plan's final review: `startWorkEmailOtp` currently creates a brand-new `insiderProfiles` row on every call, but the real schema's unique index on `insiderProfiles.userId` means a second call (e.g., a user clicking "resend code") throws a raw Postgres constraint violation — a divergence between the fake (which allowed it) and real Postgres that every existing test missed. This task makes the underlying DB method itself idempotent, so `identity.ts` doesn't need to change its calling logic at all — only the method name at its one call site.

- [ ] **Step 1: Write the failing test**

Add this new test to the existing `describe("createFakeDatabase identity", ...)` block in `src/adapters/db/fake.test.ts`:

```ts
  it("returns the existing profile when called again for the same user (idempotent)", async () => {
    const { db, seedCompany } = createFakeDatabase();
    const company = seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const user = await db.identity.findOrCreateUser("fb-idem", "idem@acme.com", "seeker");
    const first = await db.identity.findOrCreateInsiderProfile(user.id, company.id, "idem@acme.com");
    const second = await db.identity.findOrCreateInsiderProfile(user.id, company.id, "idem@acme.com");
    expect(second.id).toBe(first.id);
  });
```

Then rename every existing call to `db.identity.createInsiderProfile(` in this same file to `db.identity.findOrCreateInsiderProfile(` — there are 5 occurrences, in the tests named "creates an insider profile unverified by default", "marks an insider profile verified", "consumes a work-email OTP exactly once, rejects reuse", "rejects an expired work-email OTP", and "rejects a wrong code hash". Do not change anything else in those five tests — only the method name at the call site.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/adapters/db/fake.test.ts`
Expected: FAIL — `db.identity.findOrCreateInsiderProfile` doesn't exist yet (the interface still only has `createInsiderProfile`).

- [ ] **Step 3: Rename and change semantics in `src/adapters/db/types.ts`**

In the `Database.identity` interface, change:
```ts
    createInsiderProfile(userId: string, companyId: string, workEmail: string): Promise<InsiderProfileRecord>;
```
to:
```ts
    findOrCreateInsiderProfile(userId: string, companyId: string, workEmail: string): Promise<InsiderProfileRecord>;
```

- [ ] **Step 4: Update `src/adapters/db/fake.ts`**

Replace the existing `createInsiderProfile` method body with:
```ts
    async findOrCreateInsiderProfile(userId: string, companyId: string, workEmail: string) {
      const existing = insiderProfiles.find((p) => p.userId === userId);
      if (existing) return existing;
      const profile: InsiderProfileRecord = {
        id: genId(), userId, companyId, workEmail, verifiedAt: null, available: true, weeklyLimit: 3,
      };
      insiderProfiles.push(profile);
      return profile;
    },
```

- [ ] **Step 5: Update `src/adapters/db/real.ts`**

Replace the existing `createInsiderProfile` method body with:
```ts
    async findOrCreateInsiderProfile(userId, companyId, workEmail) {
      const [existing] = await db.select().from(insiderProfiles).where(eq(insiderProfiles.userId, userId));
      if (existing) return existing as InsiderProfileRecord;
      const [created] = await db.insert(insiderProfiles).values({ userId, companyId, workEmail }).returning();
      return created as InsiderProfileRecord;
    },
```
(This still has a SELECT-then-INSERT race under concurrent first-time calls for the same user — that race was already flagged and deferred in the Phase 1 Identity Foundation plan's review for the adjacent `findOrCreateUser` function; it applies equally here and stays deferred for the same reason: untestable without Postgres, and the same task that first wires `ADAPTERS=real` should fix both together.)

- [ ] **Step 6: Update `src/modules/identity/identity.ts`**

In `startWorkEmailOtp`, change the one call site:
```ts
  const profile = await deps.db.identity.createInsiderProfile(userId, company.id, workEmail);
```
to:
```ts
  const profile = await deps.db.identity.findOrCreateInsiderProfile(userId, company.id, workEmail);
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/adapters/db/fake.test.ts`
Expected: PASS (the renamed tests plus the new idempotency test).
Run: `npm test` — full suite passes (242 existing tests, unaffected — no existing test calls `startWorkEmailOtp` twice for the same user, so behavior for all of them is unchanged).
Run: `npm run typecheck` — must pass.

- [ ] **Step 8: Commit**

```bash
git add src/adapters/db src/modules/identity/identity.ts
git commit -m "fix(identity): make insider-profile creation idempotent per user"
```

---

## Task 2: Role promotion on Insider verification (prerequisite fix)

**Files:**
- Modify: `src/adapters/db/types.ts`
- Modify: `src/adapters/db/fake.ts`
- Modify: `src/adapters/db/fake.test.ts`
- Modify: `src/adapters/db/real.ts`
- Modify: `src/modules/identity/identity.ts`
- Modify: `src/modules/identity/identity.test.ts`

**Interfaces:**
- Produces: `Database.identity.getInsiderProfileById(insiderProfileId): Promise<InsiderProfileRecord | null>`, `Database.identity.setUserRole(userId, role): Promise<UserRecord>` — consumed by `identity.ts`'s `verifyWorkEmailOtp` in this task, and by `authorize()` callers in later tasks/plans that need to resolve an `insiderProfileId`'s owner.
- Produces: `promoteRoleForInsiderVerification(currentRole: Role): Role` (exported from `identity.ts`) — a pure helper, unit-tested directly.

This closes the first two prerequisite findings together, since fixing #1 (role promotion) requires #2 (resolving an insider profile's owner) as a building block: `verifyWorkEmailOtp` only has an `insiderProfileId`, not a `userId`, so it needs `getInsiderProfileById` to find the owner before it can promote that owner's role.

- [ ] **Step 1: Write the failing tests**

Add to `src/adapters/db/fake.test.ts`'s `describe("createFakeDatabase identity", ...)` block:

```ts
  it("gets an insider profile by id, and returns null when not found", async () => {
    const { db, seedCompany } = createFakeDatabase();
    const company = seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const user = await db.identity.findOrCreateUser("fb-gp1", "gp1@acme.com", "seeker");
    const profile = await db.identity.findOrCreateInsiderProfile(user.id, company.id, "gp1@acme.com");
    expect((await db.identity.getInsiderProfileById(profile.id))?.id).toBe(profile.id);
    expect(await db.identity.getInsiderProfileById("nope")).toBeNull();
  });

  it("sets a user's role", async () => {
    const { db } = createFakeDatabase();
    const user = await db.identity.findOrCreateUser("fb-role1", "role1@b.com", "seeker");
    const updated = await db.identity.setUserRole(user.id, "both");
    expect(updated.role).toBe("both");
    expect((await db.identity.getUserById(user.id))?.role).toBe("both");
  });

  it("throws when setting role for a nonexistent user", async () => {
    const { db } = createFakeDatabase();
    await expect(db.identity.setUserRole("nope", "both")).rejects.toThrow();
  });
```

Add to `src/modules/identity/identity.test.ts` a new `describe` block (this file already imports `signInWithFirebaseToken`, `startWorkEmailOtp`, `verifyWorkEmailOtp`, and the `makeDeps()` helper — reuse them):

```ts
import { promoteRoleForInsiderVerification } from "./identity";

describe("promoteRoleForInsiderVerification", () => {
  it("promotes a seeker to both", () => {
    expect(promoteRoleForInsiderVerification("seeker")).toBe("both");
  });

  it("leaves insider unchanged", () => {
    expect(promoteRoleForInsiderVerification("insider")).toBe("insider");
  });

  it("leaves both unchanged", () => {
    expect(promoteRoleForInsiderVerification("both")).toBe("both");
  });

  it("leaves admin unchanged", () => {
    expect(promoteRoleForInsiderVerification("admin")).toBe("admin");
  });
});

describe("verifyWorkEmailOtp role promotion", () => {
  it("promotes a seeker to \"both\" on successful verification", async () => {
    const { deps, issueToken, seedCompany } = makeDeps();
    seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const token = issueToken({ providerUid: "fb-rolep-1", email: "rolep1@acme.com" });
    const session = await signInWithFirebaseToken(deps, token);
    expect(session.role).toBe("seeker");

    const { insiderProfileId, code } = await startWorkEmailOtp(deps, session.userId, "rolep1@acme.com");
    await verifyWorkEmailOtp(deps, insiderProfileId, code);

    const user = await deps.db.identity.getUserById(session.userId);
    expect(user?.role).toBe("both");
  });

  it("does not change role when verification fails", async () => {
    const { deps, issueToken, seedCompany } = makeDeps();
    seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const token = issueToken({ providerUid: "fb-rolep-2", email: "rolep2@acme.com" });
    const session = await signInWithFirebaseToken(deps, token);

    const { insiderProfileId } = await startWorkEmailOtp(deps, session.userId, "rolep2@acme.com");
    await verifyWorkEmailOtp(deps, insiderProfileId, "000000");

    const user = await deps.db.identity.getUserById(session.userId);
    expect(user?.role).toBe("seeker");
  });

  it("leaves an already-admin role unchanged", async () => {
    const { deps, seedCompany } = makeDeps();
    seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const adminUser = await deps.db.identity.findOrCreateUser("fb-rolep-3", "admin@acme.com", "admin");

    const { insiderProfileId, code } = await startWorkEmailOtp(deps, adminUser.id, "admin@acme.com");
    await verifyWorkEmailOtp(deps, insiderProfileId, code);

    const user = await deps.db.identity.getUserById(adminUser.id);
    expect(user?.role).toBe("admin");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/adapters/db/fake.test.ts src/modules/identity/identity.test.ts`
Expected: FAIL — `getInsiderProfileById`, `setUserRole`, and `promoteRoleForInsiderVerification` don't exist yet.

- [ ] **Step 3: Add the two methods to `src/adapters/db/types.ts`**

In the `Database.identity` interface, add two new methods (after `findOrCreateInsiderProfile`):
```ts
    getInsiderProfileById(insiderProfileId: string): Promise<InsiderProfileRecord | null>;
    setUserRole(userId: string, role: Role): Promise<UserRecord>;
```

- [ ] **Step 4: Implement in `src/adapters/db/fake.ts`**

Add alongside the other `identity` methods:
```ts
    async getInsiderProfileById(insiderProfileId: string) {
      return insiderProfiles.find((p) => p.id === insiderProfileId) ?? null;
    },
    async setUserRole(userId: string, role: Role) {
      const user = users.find((u) => u.id === userId);
      if (!user) throw new Error(`User ${userId} not found`);
      user.role = role;
      return user;
    },
```

- [ ] **Step 5: Implement in `src/adapters/db/real.ts`**

Add alongside the other `identity` methods:
```ts
    async getInsiderProfileById(insiderProfileId) {
      const [row] = await db.select().from(insiderProfiles).where(eq(insiderProfiles.id, insiderProfileId));
      return (row as InsiderProfileRecord) ?? null;
    },
    async setUserRole(userId, role) {
      const [row] = await db.update(users).set({ role }).where(eq(users.id, userId)).returning();
      if (!row) throw new Error(`User ${userId} not found`);
      return row as UserRecord;
    },
```

- [ ] **Step 6: Add the pure helper and wire it into `verifyWorkEmailOtp` in `src/modules/identity/identity.ts`**

Add this exported function (near the other exports, after `WorkEmailDomainError`):
```ts
export function promoteRoleForInsiderVerification(currentRole: Role): Role {
  if (currentRole === "seeker") return "both";
  return currentRole;
}
```

Replace the existing `verifyWorkEmailOtp` function body with:
```ts
export async function verifyWorkEmailOtp(deps: IdentityDeps, insiderProfileId: string, code: string): Promise<boolean> {
  const valid = await deps.db.identity.consumeWorkEmailOtp(insiderProfileId, hashOtpCode(code), new Date());
  if (!valid) return false;

  await deps.db.identity.markInsiderVerified(insiderProfileId, new Date());

  const profile = await deps.db.identity.getInsiderProfileById(insiderProfileId);
  if (profile) {
    const user = await deps.db.identity.getUserById(profile.userId);
    if (user) {
      await deps.db.identity.setUserRole(user.id, promoteRoleForInsiderVerification(user.role));
    }
  }

  return true;
}
```
(`profile`/`user` are checked for `null` rather than asserted, so a call with a bogus `insiderProfileId` — which would already have failed the `consumeWorkEmailOtp` check above and returned early — degrades gracefully rather than throwing if this code is ever reached in an inconsistent state.)

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/adapters/db/fake.test.ts src/modules/identity/identity.test.ts`
Expected: PASS (3 new fake tests + 4 new `promoteRoleForInsiderVerification` tests + 3 new `verifyWorkEmailOtp role promotion` tests = 10 new tests).
Run: `npm test` — full suite passes. Expected total: 242 (before this plan) + 3 (Task 1's idempotency test — note Task 1's 5 renames don't add test count) + 10 (this task) = 255.
Run: `npm run typecheck` and `npm run lint` — both clean.

- [ ] **Step 8: Commit**

```bash
git add src/adapters/db src/modules/identity
git commit -m "feat(identity): promote a verified Insider's role, add getInsiderProfileById/setUserRole"
```

---

## Task 3: Drizzle schema — resumes

**Files:**
- Modify: `drizzle/schema.ts`
- Create: `drizzle/migrations/0003_resumes.sql` (generated, then renamed)

**Interfaces:**
- Produces: `resumes` Drizzle table object — consumed by Task 4's `real.ts` additions.

- [ ] **Step 1: Add the table to `drizzle/schema.ts`**

Append (after `workEmailOtps`, the last table from the Phase 1 Identity plan):
```ts
export const resumes = pgTable(
  "resumes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seekerProfileId: uuid("seeker_profile_id").notNull().references(() => seekerProfiles.id),
    objectKey: text("object_key").notNull(),
    originalFilename: text("original_filename").notNull(),
    status: text("status").notNull().default("uploaded"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusCheck: check("resumes_status_check", sql`${table.status} in ('uploaded','parsed','tailored')`),
  })
);
```
(`'parsed'` and `'tailored'` are included in the check constraint now, even though this plan only ever writes `'uploaded'`, because AGENTS.md §1.4 lists `resumes`/`tailored_resumes` as part of the same lifecycle and Phase 2's resume-tailoring pipeline will need to transition this same `status` column — adding the values to the constraint now avoids a migration just to widen a CHECK later. No code in this plan ever sets anything but `'uploaded'`.)

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a new file under `drizzle/migrations/`. Rename it to `drizzle/migrations/0003_resumes.sql` and update `drizzle/migrations/meta/_journal.json` to register it as the fourth entry (`idx: 3`), following the exact pattern used for `0000_init`/`0001_ledger_integrity`/`0002_identity`.

- [ ] **Step 3: Verify**

Run: `npm run typecheck` — must pass. Migration application against a live database is out of scope (no Postgres available), matching every prior plan.

- [ ] **Step 4: Commit**

```bash
git add drizzle/schema.ts drizzle/migrations
git commit -m "feat(db): add resumes schema"
```

Report status `DONE_WITH_CONCERNS`: the migration hasn't been applied to a live database.

---

## Task 4: Extend the Database adapter with a `resumes` sub-interface

**Files:**
- Modify: `src/adapters/db/types.ts`
- Modify: `src/adapters/db/fake.ts`
- Modify: `src/adapters/db/fake.test.ts`
- Modify: `src/adapters/db/real.ts`

**Interfaces:**
- Consumes: `resumes` table from `drizzle/schema.ts` (Task 3).
- Produces: `ResumeRecord` type and a `Database.resumes` sub-interface — consumed by Task 5's `resumes` module.

- [ ] **Step 1: Add types to `src/adapters/db/types.ts`**

Append:
```ts
export interface ResumeRecord {
  id: string;
  seekerProfileId: string;
  objectKey: string;
  originalFilename: string;
  status: string;
  createdAt: Date;
}
```

Add this key to the `Database` interface, alongside `ledger`/`config`/`identity`:
```ts
  resumes: {
    registerUpload(seekerProfileId: string, objectKey: string, originalFilename: string): Promise<ResumeRecord>;
    getResumeById(resumeId: string): Promise<ResumeRecord | null>;
    listResumesBySeekerProfileId(seekerProfileId: string): Promise<ResumeRecord[]>;
  };
```

- [ ] **Step 2: Write the failing tests**

Add a new `describe` block to `src/adapters/db/fake.test.ts`:
```ts
describe("createFakeDatabase resumes", () => {
  it("registers an upload with status \"uploaded\"", async () => {
    const { db } = createFakeDatabase();
    const resume = await db.resumes.registerUpload("seeker-1", "resumes/seeker-1/resume.pdf", "resume.pdf");
    expect(resume.status).toBe("uploaded");
    expect(resume.seekerProfileId).toBe("seeker-1");
    expect(resume.objectKey).toBe("resumes/seeker-1/resume.pdf");
  });

  it("returns null for a resume id that doesn't exist", async () => {
    const { db } = createFakeDatabase();
    expect(await db.resumes.getResumeById("nope")).toBeNull();
  });

  it("gets a resume by id", async () => {
    const { db } = createFakeDatabase();
    const created = await db.resumes.registerUpload("seeker-1", "resumes/seeker-1/a.pdf", "a.pdf");
    expect((await db.resumes.getResumeById(created.id))?.id).toBe(created.id);
  });

  it("lists resumes for a seeker profile, excluding other seekers'", async () => {
    const { db } = createFakeDatabase();
    await db.resumes.registerUpload("seeker-1", "resumes/seeker-1/a.pdf", "a.pdf");
    await db.resumes.registerUpload("seeker-1", "resumes/seeker-1/b.pdf", "b.pdf");
    await db.resumes.registerUpload("seeker-2", "resumes/seeker-2/c.pdf", "c.pdf");
    const results = await db.resumes.listResumesBySeekerProfileId("seeker-1");
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.seekerProfileId === "seeker-1")).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/adapters/db/fake.test.ts`
Expected: FAIL — `db.resumes` doesn't exist yet.

- [ ] **Step 4: Add `resumes` to `createFakeDatabase()` in `src/adapters/db/fake.ts`**

Add a new in-memory array alongside the others:
```ts
  const resumeRows: ResumeRecord[] = [];
```
(Add `ResumeRecord` to the imports from `./types`.)

Add this key to the returned `db` object, alongside `ledger`/`config`/`identity`:
```ts
    resumes: {
      async registerUpload(seekerProfileId: string, objectKey: string, originalFilename: string) {
        const resume: ResumeRecord = {
          id: genId(), seekerProfileId, objectKey, originalFilename, status: "uploaded", createdAt: new Date(),
        };
        resumeRows.push(resume);
        return resume;
      },
      async getResumeById(resumeId: string) {
        return resumeRows.find((r) => r.id === resumeId) ?? null;
      },
      async listResumesBySeekerProfileId(seekerProfileId: string) {
        return resumeRows.filter((r) => r.seekerProfileId === seekerProfileId);
      },
    },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/adapters/db/fake.test.ts`
Expected: PASS (4 new tests).

- [ ] **Step 6: Add `resumes` to `createRealDatabase()` in `src/adapters/db/real.ts`**

Add `resumes` to the schema import line (alongside `users, seekerProfiles, insiderProfiles, companies, companyDomains, workEmailOtps`), and add `ResumeRecord` to the type imports from `./types`.

Add this key to the returned object:
```ts
    resumes: {
      async registerUpload(seekerProfileId, objectKey, originalFilename) {
        const [row] = await db
          .insert(resumes)
          .values({ seekerProfileId, objectKey, originalFilename })
          .returning();
        return row as ResumeRecord;
      },
      async getResumeById(resumeId) {
        const [row] = await db.select().from(resumes).where(eq(resumes.id, resumeId));
        return (row as ResumeRecord) ?? null;
      },
      async listResumesBySeekerProfileId(seekerProfileId) {
        const rows = await db.select().from(resumes).where(eq(resumes.seekerProfileId, seekerProfileId));
        return rows as ResumeRecord[];
      },
    },
```

- [ ] **Step 7: Verify**

Run: `npm run typecheck` — `real.ts` must typecheck.
Run: `npm test` — full suite passes.

- [ ] **Step 8: Commit**

```bash
git add src/adapters/db
git commit -m "feat(adapters): extend Database with a resumes sub-interface"
```

Report status `DONE_WITH_CONCERNS`: `real.ts`'s resumes methods have not been exercised against a live Postgres instance.

---

## Task 5: `src/modules/resumes` — registerUpload

**Files:**
- Create: `src/modules/resumes/schemas.ts`
- Create: `src/modules/resumes/resumes.ts`
- Create: `src/modules/resumes/resumes.test.ts`
- Modify: `src/lib/authorize.ts`
- Modify: `src/lib/authorize.test.ts`

**Interfaces:**
- Consumes: `Database`, `ResumeRecord` from `src/adapters/db/types.ts` (Task 4).
- Produces: `registerUpload(deps, seekerProfileId, objectKey, originalFilename): Promise<RegisterUploadResult>` — the `resumes` module's public interface per AGENTS.md §3.2. Also widens `authorize.ts`'s `ResourceType` union with `"resume"`.

- [ ] **Step 1: Write `src/modules/resumes/schemas.ts`**

```ts
import { z } from "zod";

export const registerUploadInputSchema = z.object({
  seekerProfileId: z.string().uuid(),
  objectKey: z.string().min(1),
  originalFilename: z.string().min(1),
});
```

- [ ] **Step 2: Write the failing tests**

Create `src/modules/resumes/resumes.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createFakeDatabase } from "../../adapters/db/fake";
import { registerUpload, type ResumesDeps } from "./resumes";

function makeDeps(): ResumesDeps {
  const { db } = createFakeDatabase();
  return { db };
}

describe("registerUpload", () => {
  it("registers an upload and returns its id and status", async () => {
    const deps = makeDeps();
    const result = await registerUpload(deps, "seeker-1", "resumes/seeker-1/resume.pdf", "resume.pdf");
    expect(result.resumeId).toBeTruthy();
    expect(result.status).toBe("uploaded");
  });

  it("rejects an empty objectKey", async () => {
    const deps = makeDeps();
    await expect(registerUpload(deps, "seeker-1", "", "resume.pdf")).rejects.toThrow();
  });

  it("rejects an empty originalFilename", async () => {
    const deps = makeDeps();
    await expect(registerUpload(deps, "seeker-1", "resumes/seeker-1/resume.pdf", "")).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/modules/resumes/resumes.test.ts`
Expected: FAIL — `./resumes` does not exist yet.

- [ ] **Step 4: Write `src/modules/resumes/resumes.ts`**

```ts
import type { Database } from "../../adapters/db/types";

export interface ResumesDeps {
  db: Database;
}

export interface RegisterUploadResult {
  resumeId: string;
  status: string;
}

export async function registerUpload(
  deps: ResumesDeps,
  seekerProfileId: string,
  objectKey: string,
  originalFilename: string
): Promise<RegisterUploadResult> {
  if (!objectKey) throw new Error("objectKey is required");
  if (!originalFilename) throw new Error("originalFilename is required");
  const resume = await deps.db.resumes.registerUpload(seekerProfileId, objectKey, originalFilename);
  return { resumeId: resume.id, status: resume.status };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/modules/resumes/resumes.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Widen `authorize.ts`'s `ResourceType`**

In `src/lib/authorize.ts`, change:
```ts
export type ResourceType = "seekerProfile" | "insiderProfile" | "userRecord";
```
to:
```ts
export type ResourceType = "seekerProfile" | "insiderProfile" | "userRecord" | "resume";
```
(No other change needed — `authorize()`'s logic is already generic over `ResourceType`: it only ever checks `resource.ownerUserId` against `session.userId`, or allows admin. A resume's `ownerUserId` is resolved by whoever calls `authorize()` — e.g., a future server action looking up the resume's `seekerProfileId`, then that seeker profile's `userId` — not by this file.)

Add one test to `src/lib/authorize.test.ts` (in the existing `describe("authorize", ...)` block):
```ts
  it("allows a user to read their own resume", () => {
    expect(authorize(seekerSession, "read", { type: "resume", ownerUserId: "u1" })).toBe(true);
  });

  it("denies a user reading someone else's resume", () => {
    expect(authorize(seekerSession, "read", { type: "resume", ownerUserId: "u2" })).toBe(false);
  });
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/lib/authorize.test.ts`
Expected: PASS (7 tests: the original 5 plus these 2).
Run: `npm test` — full suite passes.
Run: `npm run typecheck` and `npm run lint` — both clean.

- [ ] **Step 8: Commit**

```bash
git add src/modules/resumes src/lib/authorize.ts src/lib/authorize.test.ts
git commit -m "feat(resumes): add registerUpload module, widen authorize() for resume ownership"
```

---

## Task 6: Extend the Database adapter with an `insiders` sub-interface

**Files:**
- Modify: `src/adapters/db/types.ts`
- Modify: `src/adapters/db/fake.ts`
- Modify: `src/adapters/db/fake.test.ts`
- Modify: `src/adapters/db/real.ts`

**Interfaces:**
- Produces: `InsiderSearchFilters`, `InsiderSearchResult`, and a `Database.insiders` sub-interface — consumed by Task 7's `insiders` module.

`listInsiders` returns only verified (`verifiedAt !== null`) and available (`available === true`) insiders — the public-search view. `getInsiderById` returns any insider profile regardless of verification/availability — an owner/detail lookup, not a search result. This distinction is deliberate: a not-yet-verified Insider should never appear in a Seeker's search results, but the Insider themselves (or an admin) still needs to be able to fetch their own profile's detail.

- [ ] **Step 1: Add types to `src/adapters/db/types.ts`**

Append:
```ts
export interface InsiderSearchFilters {
  companyId?: string;
}

export interface InsiderSearchResult {
  insiderProfileId: string;
  companyId: string;
  companyName: string;
  companyTier: string;
}
```

Add this key to the `Database` interface, alongside `ledger`/`config`/`identity`/`resumes`:
```ts
  insiders: {
    listInsiders(filters: InsiderSearchFilters): Promise<InsiderSearchResult[]>;
    getInsiderById(insiderProfileId: string): Promise<InsiderSearchResult | null>;
    setAvailability(insiderProfileId: string, available: boolean): Promise<void>;
  };
```

- [ ] **Step 2: Write the failing tests**

Add a new `describe` block to `src/adapters/db/fake.test.ts`:
```ts
describe("createFakeDatabase insiders", () => {
  async function makeVerifiedInsider(db: ReturnType<typeof createFakeDatabase>["db"], seedCompany: ReturnType<typeof createFakeDatabase>["seedCompany"], fbUid: string, email: string, companyName: string) {
    const company = seedCompany({ name: companyName, tier: "tier1" }, [`${companyName.toLowerCase().replace(/\s+/g, "")}.com`]);
    const user = await db.identity.findOrCreateUser(fbUid, email, "seeker");
    const profile = await db.identity.findOrCreateInsiderProfile(user.id, company.id, email);
    await db.identity.markInsiderVerified(profile.id, new Date());
    return { company, profile };
  }

  it("excludes unverified insiders from search results", async () => {
    const { db, seedCompany } = createFakeDatabase();
    const company = seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const user = await db.identity.findOrCreateUser("fb-unv", "unv@acme.com", "seeker");
    await db.identity.findOrCreateInsiderProfile(user.id, company.id, "unv@acme.com");
    expect(await db.insiders.listInsiders({})).toHaveLength(0);
  });

  it("includes verified, available insiders in search results", async () => {
    const { db, seedCompany } = createFakeDatabase();
    await makeVerifiedInsider(db, seedCompany, "fb-v1", "v1@acme.com", "Acme");
    const results = await db.insiders.listInsiders({});
    expect(results).toHaveLength(1);
    expect(results[0].companyName).toBe("Acme");
  });

  it("filters search results by companyId", async () => {
    const { db, seedCompany } = createFakeDatabase();
    const { company: acme } = await makeVerifiedInsider(db, seedCompany, "fb-v2", "v2@acme.com", "Acme");
    await makeVerifiedInsider(db, seedCompany, "fb-v3", "v3@beta.com", "Beta");
    const results = await db.insiders.listInsiders({ companyId: acme.id });
    expect(results).toHaveLength(1);
    expect(results[0].companyName).toBe("Acme");
  });

  it("excludes unavailable insiders from search results", async () => {
    const { db, seedCompany } = createFakeDatabase();
    const { profile } = await makeVerifiedInsider(db, seedCompany, "fb-v4", "v4@acme.com", "Acme");
    await db.insiders.setAvailability(profile.id, false);
    expect(await db.insiders.listInsiders({})).toHaveLength(0);
  });

  it("getInsiderById returns an unverified insider too (unlike listInsiders)", async () => {
    const { db, seedCompany } = createFakeDatabase();
    const company = seedCompany({ name: "Acme", tier: "tier1" }, ["acme.com"]);
    const user = await db.identity.findOrCreateUser("fb-gi1", "gi1@acme.com", "seeker");
    const profile = await db.identity.findOrCreateInsiderProfile(user.id, company.id, "gi1@acme.com");
    expect((await db.insiders.getInsiderById(profile.id))?.insiderProfileId).toBe(profile.id);
  });

  it("getInsiderById returns null when not found", async () => {
    const { db } = createFakeDatabase();
    expect(await db.insiders.getInsiderById("nope")).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/adapters/db/fake.test.ts`
Expected: FAIL — `db.insiders` doesn't exist yet.

- [ ] **Step 4: Add `insiders` to `createFakeDatabase()` in `src/adapters/db/fake.ts`**

Add a shared helper function inside `createFakeDatabase()` (near the other closures), and the `insiders` key on the returned `db` object:
```ts
  function toSearchResult(profile: InsiderProfileRecord): InsiderSearchResult | null {
    const company = companies.find((c) => c.id === profile.companyId);
    if (!company) return null;
    return { insiderProfileId: profile.id, companyId: company.id, companyName: company.name, companyTier: company.tier };
  }
```
```ts
    insiders: {
      async listInsiders(filters: InsiderSearchFilters) {
        return insiderProfiles
          .filter((p) => p.verifiedAt !== null && p.available)
          .filter((p) => !filters.companyId || p.companyId === filters.companyId)
          .map(toSearchResult)
          .filter((r): r is InsiderSearchResult => r !== null);
      },
      async getInsiderById(insiderProfileId: string) {
        const profile = insiderProfiles.find((p) => p.id === insiderProfileId);
        if (!profile) return null;
        return toSearchResult(profile);
      },
      async setAvailability(insiderProfileId: string, available: boolean) {
        const profile = insiderProfiles.find((p) => p.id === insiderProfileId);
        if (profile) profile.available = available;
      },
    },
```
(Add `InsiderSearchFilters`, `InsiderSearchResult` to the imports from `./types`.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/adapters/db/fake.test.ts`
Expected: PASS (6 new tests).

- [ ] **Step 6: Add `insiders` to `createRealDatabase()` in `src/adapters/db/real.ts`**

Add `and, isNotNull` to the `drizzle-orm` import line if not already present (`isNull`/`and` should already be imported from Task 2 of the Phase 1 Identity plan; add `isNotNull` alongside them). Add `InsiderSearchFilters`, `InsiderSearchResult` to the type imports from `./types`.

```ts
    insiders: {
      async listInsiders(filters) {
        const conditions = [eq(insiderProfiles.available, true), isNotNull(insiderProfiles.verifiedAt)];
        if (filters.companyId) conditions.push(eq(insiderProfiles.companyId, filters.companyId));

        const rows = await db
          .select({
            insiderProfileId: insiderProfiles.id,
            companyId: companies.id,
            companyName: companies.name,
            companyTier: companies.tier,
          })
          .from(insiderProfiles)
          .innerJoin(companies, eq(insiderProfiles.companyId, companies.id))
          .where(and(...conditions));

        return rows as InsiderSearchResult[];
      },
      async getInsiderById(insiderProfileId) {
        const [row] = await db
          .select({
            insiderProfileId: insiderProfiles.id,
            companyId: companies.id,
            companyName: companies.name,
            companyTier: companies.tier,
          })
          .from(insiderProfiles)
          .innerJoin(companies, eq(insiderProfiles.companyId, companies.id))
          .where(eq(insiderProfiles.id, insiderProfileId));
        return (row as InsiderSearchResult) ?? null;
      },
      async setAvailability(insiderProfileId, available) {
        await db.update(insiderProfiles).set({ available }).where(eq(insiderProfiles.id, insiderProfileId));
      },
    },
```

- [ ] **Step 7: Verify**

Run: `npm run typecheck` — must pass.
Run: `npm test` — full suite passes.

- [ ] **Step 8: Commit**

```bash
git add src/adapters/db
git commit -m "feat(adapters): extend Database with an insiders sub-interface"
```

Report status `DONE_WITH_CONCERNS`: `real.ts`'s insiders methods have not been exercised against a live Postgres instance.

---

## Task 7: `src/modules/insiders` — listInsiders, getInsider, setAvailability

**Files:**
- Create: `src/modules/insiders/insiders.ts`
- Create: `src/modules/insiders/insiders.test.ts`

**Interfaces:**
- Consumes: `Database`, `InsiderSearchFilters`, `InsiderSearchResult` from `src/adapters/db/types.ts` (Task 6); `getRules` from `src/modules/config/config.ts` and `Rules` from `src/modules/config/schemas.ts` (both from the completed Phase 0 plan).
- Produces: `InsiderSummary`, `listInsiders(deps, filters?)`, `getInsider(deps, insiderProfileId)`, `setAvailability(deps, insiderProfileId, available)` — the `insiders` module's public interface per AGENTS.md §3.2.

- [ ] **Step 1: Write the failing tests**

Create `src/modules/insiders/insiders.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/insiders/insiders.test.ts`
Expected: FAIL — `./insiders` does not exist yet.

- [ ] **Step 3: Write `src/modules/insiders/insiders.ts`**

```ts
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

function toSummary(result: InsiderSearchResult, rules: Rules): InsiderSummary {
  return {
    insiderProfileId: result.insiderProfileId,
    companyName: result.companyName,
    companyTier: result.companyTier,
    creditCost: rules.requestCostByTier[result.companyTier] ?? 0,
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/modules/insiders/insiders.test.ts`
Expected: PASS (7 tests).
Run: `npm test` — full suite passes. Expected total: 255 (after Task 2) + 4 (Task 4) + 3 (Task 5) + 6 (Task 6) + 7 (this task) + 2 (Task 5's authorize.test.ts additions, already counted in Task 5's own total) = verify the exact final count in your own report rather than trusting this arithmetic — the important thing is every task's own new tests pass and nothing regresses.
Run: `npm run typecheck` and `npm run lint` — both clean.

- [ ] **Step 5: Commit**

```bash
git add src/modules/insiders
git commit -m "feat(insiders): add listInsiders, getInsider, setAvailability with config-driven credit cost"
```

---

## Plan Self-Review Notes

- **Spec coverage:** AGENTS.md §3.11's Phase 1 backend backlog "insiders search" and "resumes upload registration" bullets are both covered (Tasks 3-7). The three prerequisite findings from the Phase 1 Identity Foundation plan's final review (role promotion, `getInsiderProfileById`, idempotent OTP-triggered profile creation) are Tasks 1-2, executed first as that review recommended.
- **Deliberately deferred, with rationale stated inline:** `weeklyLimit` enforcement in `listInsiders`/request-sending (AGENTS.md's weekly-limit concept exists on `insiderProfiles` since the Phase 1 Identity plan, but nothing in this plan's scope — search, detail, availability — needs to check it; it belongs with the `requests.sendRequest` plan that actually consumes an Insider's capacity); resume parsing/tailoring (`status` transitions beyond `'uploaded'` — Phase 2, per AGENTS.md §3.11); `scheduleReverify`/re-verification timers (AGENTS.md §3.2 lists this as part of the `insiders` module, but it's a pg-boss job — the Phase 1 backlog places "timers" after "requests.sendRequest" and before "email notifications", so it belongs in the requests/rewards sub-plan, not here).
- **Type consistency:** `InsiderSearchResult`/`InsiderSearchFilters` (Task 6) are used identically by both `Database.insiders`'s fake and real implementations and by the `insiders` module (Task 7) — checked field-for-field (`insiderProfileId`, `companyId`, `companyName`, `companyTier`) across both adapter implementations and the module's `toSummary` mapper. `findOrCreateInsiderProfile`'s renamed signature (Task 1) is used consistently in every later task that touches an insider profile (Tasks 2, 6's test helper).
- **Next plan:** requests.sendRequest with escrow (wiring the already-built `ledger`/`requests/state` modules from Phase 0 to real persistence) → accept/decline/expire → proof + admin verify (including `admin.grantCredits`, since a Seeker cannot send a request without credits and Razorpay is Phase 2) → timers → email notifications → rewards on the manual vendor → Playwright flows. This is the largest remaining Phase 1 backend slice and should get its own dedicated planning pass once this plan lands, per the same sub-project decomposition principle used throughout Phase 1.
