# Phase 0 Backend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the backend foundation GetNudgd's Phase 1+ modules build on: env/brand config, the ledger and request-state-machine pure modules, the DB/storage/email/queue adapter interfaces with fakes, `/api/health`, the pg-boss worker entry, CI, and removal of the known security defects in the current waitlist/survey API routes.

**Architecture:** Everything lives under `src/` (`config`, `modules`, `adapters`, `jobs`, `lib`) plus `drizzle/` for schema/migrations and `infra/`/`.github/` for deploy plumbing. Domain modules (`src/modules/ledger`, `src/modules/config`) are pure — they take a `deps: { db: Database }` object and never import Drizzle or a vendor SDK directly. Every vendor-facing capability (Postgres, Cloud Storage, email, the pg-boss queue) is behind an interface in `src/adapters/*` with a `fake.ts` used by all tests and local dev; `real.ts` implementations exist but cannot be integration-verified in this session because Docker/Postgres is not yet installed on the founder's machine (see Global Constraints).

**Tech Stack:** TypeScript strict, Zod, Drizzle ORM (`drizzle-orm` + `drizzle-kit` + `pg`), pg-boss, Vitest, tsx.

**Spec:** `AGENTS.md` at the repo root — specifically §0.4 (locked vocabulary), §0.5 (config not code), §1.2–1.5 (stack, repo layout, data model, request state machine), Part 2 (shared rules), Part 3 (backend rules, module table, ledger rules, jobs table, known defects), Part 7 (env vars), Part 8 (commands). There is no separate design doc for this phase — AGENTS.md §3.9/§3.11 already fully specify Phase 0 backend scope, so brainstorming was skipped per AGENTS.md §6.1 ("skip brainstorming only when a spec already exists for the exact scope").

## Global Constraints

- TypeScript `strict`, no `any`, no `@ts-ignore`. Zod at every boundary. (AGENTS.md Part 2.1)
- Domain modules (`src/modules/*`) import no Next.js, no Drizzle client, no vendor SDK; they receive adapters via a `deps` object. (Part 2.2)
- Every vendor is behind an interface with a fake, added in the same task as the interface. (Part 2.3)
- Idempotency key required on anything that moves money or sends a message, derived from the triggering event. (Part 2.4)
- Append-only tables (`ledger_entries` here; `request_events`/`admin_audit_log` land in later phases) allow no `UPDATE`/`DELETE`, enforced in the schema. (Part 2.5)
- No secret may live in a `NEXT_PUBLIC_` variable; `src/config/env.ts` validates env at boot and fails fast on missing required vars. (Part 2.6)
- No vendor error bodies or debug fields in client responses; errors are problem-shaped, not raw vendor payloads. (Part 2.7)
- Locked vocabulary (Insider, Seeker, Insider Request, vouch, credits, points, "Get vouched in") applies in code, schema, copy, and commit messages — never "referrer", "refer", "job seeker" (as an identifier), "payout", "coins"/"tokens". (Part 0.4)
- Business numbers (response window, refund %, tranche split, etc.) are configuration read through `src/modules/config`, never literals in domain code; seed values are marked `placeholder: true`. (Part 0.5)
- Small, verified commits with `type(scope): summary` messages; run `npm run lint && npm run typecheck && npm test` before each commit. Never commit to `main` directly — this plan executes on branch `phase-0`. (Part 2.10)
- Do not add dependencies without a stated reason (each task below states why any new dependency is added). (Part 2.11)
- **Docker is not yet installed** on the founder's machine (confirmed via both Git Bash and PowerShell — `docker` is not on PATH). Docker Desktop will be installed by the founder shortly. Tasks that touch `infra/` (Dockerfile, compose files) and any `real.ts` adapter that talks to actual Postgres must be written now but **cannot be runtime-verified in this session**. Each such task's verification step says exactly what to run once Docker/Postgres exist, and the task report must say `DONE_WITH_CONCERNS` noting the deferred verification.
- Credit packs do not yet have a dedicated SQL table (that lands with the full `payments`/`credit_packs` data model in Phase 2 per AGENTS.md §1.4). For Phase 0/1, `getPacks()` reads a `credit_packs`-keyed row out of `app_config`, matching the `config` module's public interface (`getRules(version?)`, `getPacks()`) without building ahead of the phase that needs a real table.
- Storage, email, and queue (pg-boss) adapters are built now because `/api/health` and later Phase 1 modules need their interfaces; payments, WhatsApp, LLM, docgen, and gift-card adapters are **not** built in Phase 0 — nothing in Phase 0 or the start of Phase 1 consumes them yet, and building them now would be speculative code with no test consumer. They are built in the phase whose module first needs them (Phase 1 identity/resumes, Phase 2 payments/WhatsApp/LLM/docgen, Phase 3 gift cards).

---

## Task 1: Backend tooling — dependencies, npm scripts, Vitest config

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

**Interfaces:**
- Produces: `npm run typecheck`, `npm test`, `npm run test:watch`, `npm run worker:dev`, `npm run db:generate`, `npm run db:migrate`, `npm run db:seed` scripts that every later backend task relies on.

- [ ] **Step 1: Install dependencies**

Run:
```bash
npm install zod drizzle-orm pg pg-boss
npm install -D drizzle-kit vitest @vitest/coverage-v8 tsx @types/pg
```
Reason for each: `zod` — Part 2.1 boundary validation; `drizzle-orm`/`pg`/`drizzle-kit` — the decided ORM/migration tool (AGENTS.md §1.2); `pg-boss` — the decided jobs/timers engine (§1.2); `vitest`/`@vitest/coverage-v8` — the decided test runner (§1.2, §3.8 coverage requirement); `tsx` — runs the worker entry and DB scripts without a separate build step.

- [ ] **Step 2: Add npm scripts**

Edit `package.json` `scripts` to:
```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest",
  "worker:dev": "tsx watch src/jobs/run-worker.ts",
  "db:generate": "drizzle-kit generate",
  "db:migrate": "tsx scripts/migrate.ts",
  "db:seed": "tsx scripts/seed.ts"
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck` — expect it to pass (no `.ts` files besides config yet).
Run: `npm test` — expect `vitest` to report "No test files found" without erroring.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore(backend): add Drizzle, pg-boss, Zod, Vitest tooling and npm scripts"
```

---

## Task 2: `src/config/brand.ts` and `src/config/env.ts`

**Files:**
- Create: `src/config/brand.ts`
- Create: `src/config/env.ts`
- Create: `src/config/env.test.ts`
- Create: `.env.local.example`

**Interfaces:**
- Produces: `brand: Brand` (from `src/config/brand.ts`), `getEnv(): Env` and `resetEnvCacheForTests(): void` (from `src/config/env.ts`) — every later backend task that needs an env var calls `getEnv()`.

- [ ] **Step 1: Write the failing tests**

Create `src/config/env.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getEnv, resetEnvCacheForTests } from "./env";

const REQUIRED_ENV = {
  APP_URL: "http://localhost:3000",
  BRAND_NAME: "GetNudgd",
  BRAND_DOMAIN: "getnudgd.com",
  DATABASE_URL: "postgres://getnudgd:getnudgd@localhost:5432/getnudgd",
};

describe("getEnv", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetEnvCacheForTests();
    process.env = { ...originalEnv, ...REQUIRED_ENV };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetEnvCacheForTests();
  });

  it("parses a minimal valid environment", () => {
    const env = getEnv();
    expect(env.APP_URL).toBe(REQUIRED_ENV.APP_URL);
    expect(env.NODE_ENV).toBe("development");
    expect(env.ADAPTERS).toBe("fake");
    expect(env.GIFTCARD_VENDOR).toBe("manual");
  });

  it("throws with the missing field name when a required var is absent", () => {
    delete process.env.DATABASE_URL;
    expect(() => getEnv()).toThrow(/DATABASE_URL/);
  });

  it("leaves optional vendor secrets undefined when not set", () => {
    const env = getEnv();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.RAZORPAY_KEY_ID).toBeUndefined();
  });

  it("caches the parsed result across calls until reset", () => {
    const first = getEnv();
    process.env.APP_URL = "http://changed.example";
    const second = getEnv();
    expect(second).toBe(first);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/config/env.test.ts`
Expected: FAIL — `./env` does not exist yet.

- [ ] **Step 3: Write `src/config/brand.ts`**

```ts
export const brand = {
  name: "GetNudgd",
  domain: "getnudgd.com",
  url: "https://getnudgd.com",
  ctaGetVouched: "Get vouched in",
  tagline: "Sifarish toh hoti hai. Ab fair bhi hai.",
  social: {
    linkedin: "https://www.linkedin.com/company/getnudgd/",
    instagram: "https://www.instagram.com/getnudgd?igsh=dWt3Z3NtcXV3eW5k",
  },
} as const;

export type Brand = typeof brand;
```

- [ ] **Step 4: Write `src/config/env.ts`**

```ts
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url(),
  BRAND_NAME: z.string().min(1),
  BRAND_DOMAIN: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  ADAPTERS: z.enum(["fake", "real"]).default("fake"),

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

  SESSION_COOKIE_SECRET: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  ADMIN_IP_ALLOWLIST: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test-only: clears the module-level cache so tests can mutate process.env between cases. */
export function resetEnvCacheForTests(): void {
  cached = undefined;
}
```

Required vars are the ones Phase 0 actually consumes (`APP_URL`, `BRAND_NAME`, `BRAND_DOMAIN`, `DATABASE_URL`); every Phase 1+ vendor secret from AGENTS.md Part 7 is present and typed but `.optional()` so Phase 0 dev/CI doesn't need credentials that don't exist yet, while still failing fast the moment a required var is missing.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/config/env.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Write a brand test and `.env.local.example`**

Create `src/config/brand.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { brand } from "./brand";

describe("brand", () => {
  it("uses the GetNudgd brand, never the outdated Referly name", () => {
    expect(brand.name).toBe("GetNudgd");
    expect(brand.domain).toBe("getnudgd.com");
  });

  it("uses the locked CTA copy", () => {
    expect(brand.ctaGetVouched).toBe("Get vouched in");
  });
});
```

Create `.env.local.example`:
```
NODE_ENV=development
APP_URL=http://localhost:3000
BRAND_NAME=GetNudgd
BRAND_DOMAIN=getnudgd.com
DATABASE_URL=postgres://getnudgd:getnudgd@localhost:5432/getnudgd
ADAPTERS=fake
```

- [ ] **Step 7: Run full backend test suite**

Run: `npm test`
Expected: PASS (6 tests total).

- [ ] **Step 8: Commit**

```bash
git add src/config .env.local.example
git commit -m "feat(config): add Zod-validated env loader and brand constants"
```

---

## Task 3: Drizzle schema and first migration (`app_config`, ledger tables)

**Files:**
- Create: `drizzle.config.ts`
- Create: `drizzle/schema.ts`
- Create: `drizzle/migrations/0000_init.sql` (generated)
- Create: `drizzle/migrations/0001_ledger_integrity.sql`

**Interfaces:**
- Produces: `appConfig`, `ledgerAccounts`, `ledgerTxns`, `ledgerEntries` Drizzle table objects (from `drizzle/schema.ts`) — consumed by Task 4's `real.ts` adapter.

- [ ] **Step 1: Write `drizzle.config.ts`**

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://localhost:5432/getnudgd",
  },
});
```

- [ ] **Step 2: Write `drizzle/schema.ts`**

```ts
import { pgTable, uuid, text, integer, timestamp, jsonb, boolean, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const appConfig = pgTable(
  "app_config",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    version: integer("version").notNull(),
    value: jsonb("value").notNull(),
    placeholder: boolean("placeholder").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    keyVersionIdx: uniqueIndex("app_config_key_version_idx").on(table.key, table.version),
  })
);

export const ledgerAccounts = pgTable(
  "ledger_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerType: text("owner_type").notNull(),
    ownerId: text("owner_id").notNull(),
    currency: text("currency").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    ownerCurrencyIdx: uniqueIndex("ledger_accounts_owner_currency_idx").on(
      table.ownerType,
      table.ownerId,
      table.currency
    ),
    ownerTypeCheck: check("ledger_accounts_owner_type_check", sql`${table.ownerType} in ('platform','seeker','insider','escrow')`),
    currencyCheck: check("ledger_accounts_currency_check", sql`${table.currency} in ('credits','points')`),
  })
);

export const ledgerTxns = pgTable(
  "ledger_txns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    idempotencyKey: text("idempotency_key").notNull(),
    eventType: text("event_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    idempotencyKeyIdx: uniqueIndex("ledger_txns_idempotency_key_idx").on(table.idempotencyKey),
  })
);

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    txnId: uuid("txn_id").notNull().references(() => ledgerTxns.id),
    accountId: uuid("account_id").notNull().references(() => ledgerAccounts.id),
    currency: text("currency").notNull(),
    amount: integer("amount").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    currencyCheck: check("ledger_entries_currency_check", sql`${table.currency} in ('credits','points')`),
  })
);
```

- [ ] **Step 3: Generate the first migration**

Run: `npm run db:generate` (this only reads `drizzle/schema.ts`; it does not need a live Postgres connection).
Expected: a new file appears under `drizzle/migrations/`, e.g. `0000_<slug>.sql`, containing `CREATE TABLE` statements for all four tables. Rename it to `drizzle/migrations/0000_init.sql` for a stable, readable name (`git mv` the generated file; also update the matching entry Drizzle writes to `drizzle/migrations/meta/_journal.json` so the migrator finds it under the new name).

- [ ] **Step 4: Hand-write the ledger integrity migration**

Create `drizzle/migrations/0001_ledger_integrity.sql`:
```sql
-- Append-only enforcement for ledger_entries (Part 2.5)
CREATE OR REPLACE FUNCTION forbid_ledger_entries_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entries_no_update
  BEFORE UPDATE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_entries_mutation();

CREATE TRIGGER ledger_entries_no_delete
  BEFORE DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_entries_mutation();

-- Zero-sum-per-currency enforcement (Part 3.3), deferred so a whole
-- transaction's entries can be inserted before the check runs.
CREATE OR REPLACE FUNCTION check_ledger_zero_sum()
RETURNS trigger AS $$
DECLARE
  imbalance RECORD;
BEGIN
  SELECT currency, SUM(amount) AS total
  INTO imbalance
  FROM ledger_entries
  WHERE txn_id = NEW.txn_id AND currency = NEW.currency
  GROUP BY currency
  HAVING SUM(amount) <> 0;

  IF FOUND THEN
    RAISE EXCEPTION 'ledger_txns % is not zero-sum for currency % (sum=%)',
      NEW.txn_id, imbalance.currency, imbalance.total;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER ledger_entries_zero_sum
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_ledger_zero_sum();

-- Materialized view of current balances per account/currency (Part 1.4)
CREATE MATERIALIZED VIEW ledger_balances AS
SELECT account_id, currency, SUM(amount) AS balance
FROM ledger_entries
GROUP BY account_id, currency;

CREATE UNIQUE INDEX ledger_balances_account_currency_idx
  ON ledger_balances (account_id, currency);
```

Add this filename to `drizzle/migrations/meta/_journal.json` following the same entry shape Drizzle used for `0000_init.sql`, so `db:migrate` applies it in order.

- [ ] **Step 5: Verify**

Run: `npm run typecheck` — `drizzle/schema.ts` and `drizzle.config.ts` must typecheck cleanly.
This task's SQL cannot be applied to a real database yet (no Postgres running). Once Docker/Postgres is available, verify with `npm run db:migrate` followed by `psql $DATABASE_URL -c "\d ledger_entries"` to confirm the triggers exist, and `INSERT`-ing an intentionally imbalanced transaction to confirm it raises. Note this in the task report as a deferred verification.

- [ ] **Step 6: Commit**

```bash
git add drizzle.config.ts drizzle/schema.ts drizzle/migrations
git commit -m "feat(db): add app_config and ledger schema with zero-sum and append-only enforcement"
```

Report status `DONE_WITH_CONCERNS`: the SQL has not been applied to a real Postgres instance because Docker is not yet installed.

---

## Task 4: `src/adapters/db` — interface, fake, and real implementations

**Files:**
- Create: `src/adapters/db/types.ts`
- Create: `src/adapters/db/fake.ts`
- Create: `src/adapters/db/fake.test.ts`
- Create: `src/adapters/db/real.ts`

**Interfaces:**
- Consumes: `appConfig`, `ledgerAccounts`, `ledgerTxns`, `ledgerEntries` from `drizzle/schema.ts` (Task 3).
- Produces: `Database` interface, `createFakeDatabase(): { db: Database; seedConfig(row: AppConfigRecord): void }`, `createRealDatabase(db: NodePgDatabase): Database` — consumed by Tasks 5 (ledger), 7 (config), and 10 (health).

- [ ] **Step 1: Write `src/adapters/db/types.ts`**

```ts
export type LedgerOwnerType = "platform" | "seeker" | "insider" | "escrow";
export type LedgerCurrency = "credits" | "points";

export interface LedgerAccountRecord {
  id: string;
  ownerType: LedgerOwnerType;
  ownerId: string;
  currency: LedgerCurrency;
}

export interface LedgerEntryRecord {
  id: string;
  txnId: string;
  accountId: string;
  currency: LedgerCurrency;
  amount: number;
}

export interface LedgerTxnRecord {
  id: string;
  idempotencyKey: string;
  eventType: string;
  createdAt: Date;
  entries: LedgerEntryRecord[];
}

export interface PostLedgerEntryInput {
  ownerType: LedgerOwnerType;
  ownerId: string;
  currency: LedgerCurrency;
  amount: number;
}

export interface PostLedgerTxnInput {
  idempotencyKey: string;
  eventType: string;
  entries: PostLedgerEntryInput[];
}

export class LedgerImbalanceError extends Error {
  constructor(currency: LedgerCurrency, sum: number) {
    super(`Ledger transaction is not zero-sum for currency "${currency}" (sum=${sum})`);
    this.name = "LedgerImbalanceError";
  }
}

export interface AppConfigRecord {
  key: string;
  version: number;
  value: unknown;
  placeholder: boolean;
}

export interface Database {
  ledger: {
    postTxn(input: PostLedgerTxnInput): Promise<LedgerTxnRecord>;
    getBalance(ownerType: LedgerOwnerType, ownerId: string, currency: LedgerCurrency): Promise<number>;
    findAccount(ownerType: LedgerOwnerType, ownerId: string, currency: LedgerCurrency): Promise<LedgerAccountRecord | null>;
  };
  config: {
    getLatest(key: string): Promise<AppConfigRecord | null>;
    getVersion(key: string, version: number): Promise<AppConfigRecord | null>;
  };
}
```

- [ ] **Step 2: Write the failing fake tests**

Create `src/adapters/db/fake.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createFakeDatabase } from "./fake";
import { LedgerImbalanceError } from "./types";

describe("createFakeDatabase ledger", () => {
  it("posts a balanced transaction and reflects it in balances", async () => {
    const { db } = createFakeDatabase();
    await db.ledger.postTxn({
      idempotencyKey: "t1",
      eventType: "test",
      entries: [
        { ownerType: "platform", ownerId: "platform", currency: "credits", amount: -5 },
        { ownerType: "seeker", ownerId: "s1", currency: "credits", amount: 5 },
      ],
    });
    expect(await db.ledger.getBalance("seeker", "s1", "credits")).toBe(5);
  });

  it("rejects an imbalanced transaction", async () => {
    const { db } = createFakeDatabase();
    await expect(
      db.ledger.postTxn({
        idempotencyKey: "t2",
        eventType: "test",
        entries: [{ ownerType: "seeker", ownerId: "s1", currency: "credits", amount: 5 }],
      })
    ).rejects.toThrow(LedgerImbalanceError);
  });

  it("is idempotent on repeated idempotency key", async () => {
    const { db } = createFakeDatabase();
    const input = {
      idempotencyKey: "t3",
      eventType: "test",
      entries: [
        { ownerType: "platform" as const, ownerId: "platform", currency: "credits" as const, amount: -1 },
        { ownerType: "seeker" as const, ownerId: "s1", currency: "credits" as const, amount: 1 },
      ],
    };
    const first = await db.ledger.postTxn(input);
    const second = await db.ledger.postTxn(input);
    expect(second.id).toBe(first.id);
    expect(await db.ledger.getBalance("seeker", "s1", "credits")).toBe(1);
  });

  it("returns null for an account that was never posted to", async () => {
    const { db } = createFakeDatabase();
    expect(await db.ledger.findAccount("insider", "unknown", "points")).toBeNull();
  });
});

describe("createFakeDatabase config", () => {
  it("returns null when a key has no rows", async () => {
    const { db } = createFakeDatabase();
    expect(await db.config.getLatest("rules")).toBeNull();
  });

  it("seedConfig makes a row visible via getLatest and getVersion", async () => {
    const { db, seedConfig } = createFakeDatabase();
    seedConfig({ key: "rules", version: 1, value: { a: 1 }, placeholder: true });
    seedConfig({ key: "rules", version: 2, value: { a: 2 }, placeholder: true });
    expect((await db.config.getLatest("rules"))?.version).toBe(2);
    expect((await db.config.getVersion("rules", 1))?.value).toEqual({ a: 1 });
  });
});
```

- [ ] **Step 2b: Run test to verify it fails**

Run: `npx vitest run src/adapters/db/fake.test.ts`
Expected: FAIL — `./fake` does not exist yet.

- [ ] **Step 3: Write `src/adapters/db/fake.ts`**

```ts
import {
  Database,
  LedgerAccountRecord,
  LedgerCurrency,
  LedgerOwnerType,
  LedgerTxnRecord,
  PostLedgerTxnInput,
  LedgerImbalanceError,
  AppConfigRecord,
} from "./types";

function assertZeroSum(entries: PostLedgerTxnInput["entries"]): void {
  const sums = new Map<LedgerCurrency, number>();
  for (const e of entries) sums.set(e.currency, (sums.get(e.currency) ?? 0) + e.amount);
  for (const [currency, sum] of sums) {
    if (sum !== 0) throw new LedgerImbalanceError(currency, sum);
  }
}

export function createFakeDatabase(): { db: Database; seedConfig: (row: AppConfigRecord) => void } {
  const accounts: LedgerAccountRecord[] = [];
  const txns: LedgerTxnRecord[] = [];
  const configRows: AppConfigRecord[] = [];
  let nextId = 1;
  const genId = () => `fake-${nextId++}`;

  function findOrCreateAccount(ownerType: LedgerOwnerType, ownerId: string, currency: LedgerCurrency): LedgerAccountRecord {
    let account = accounts.find((a) => a.ownerType === ownerType && a.ownerId === ownerId && a.currency === currency);
    if (!account) {
      account = { id: genId(), ownerType, ownerId, currency };
      accounts.push(account);
    }
    return account;
  }

  const db: Database = {
    ledger: {
      async postTxn(input) {
        const existing = txns.find((t) => t.idempotencyKey === input.idempotencyKey);
        if (existing) return existing;

        assertZeroSum(input.entries);

        const txnId = genId();
        const entries = input.entries.map((e) => {
          const account = findOrCreateAccount(e.ownerType, e.ownerId, e.currency);
          return { id: genId(), txnId, accountId: account.id, currency: e.currency, amount: e.amount };
        });
        const txn: LedgerTxnRecord = {
          id: txnId,
          idempotencyKey: input.idempotencyKey,
          eventType: input.eventType,
          createdAt: new Date(),
          entries,
        };
        txns.push(txn);
        return txn;
      },
      async getBalance(ownerType, ownerId, currency) {
        const account = accounts.find((a) => a.ownerType === ownerType && a.ownerId === ownerId && a.currency === currency);
        if (!account) return 0;
        return txns
          .flatMap((t) => t.entries)
          .filter((e) => e.accountId === account.id)
          .reduce((sum, e) => sum + e.amount, 0);
      },
      async findAccount(ownerType, ownerId, currency) {
        return accounts.find((a) => a.ownerType === ownerType && a.ownerId === ownerId && a.currency === currency) ?? null;
      },
    },
    config: {
      async getLatest(key) {
        const rows = configRows.filter((r) => r.key === key);
        if (rows.length === 0) return null;
        return rows.reduce((latest, r) => (r.version > latest.version ? r : latest));
      },
      async getVersion(key, version) {
        return configRows.find((r) => r.key === key && r.version === version) ?? null;
      },
    },
  };

  return { db, seedConfig: (row: AppConfigRecord) => configRows.push(row) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/adapters/db/fake.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Write `src/adapters/db/real.ts`**

```ts
import { eq, and, sum } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { ledgerAccounts, ledgerTxns, ledgerEntries, appConfig } from "../../../drizzle/schema";
import type { Database, LedgerCurrency, PostLedgerTxnInput } from "./types";
import { LedgerImbalanceError } from "./types";

function assertZeroSum(entries: PostLedgerTxnInput["entries"]): void {
  const sums = new Map<LedgerCurrency, number>();
  for (const e of entries) sums.set(e.currency, (sums.get(e.currency) ?? 0) + e.amount);
  for (const [currency, total] of sums) {
    if (total !== 0) throw new LedgerImbalanceError(currency, total);
  }
}

export function createRealDatabase(db: NodePgDatabase): Database {
  return {
    ledger: {
      async postTxn(input) {
        assertZeroSum(input.entries);

        return db.transaction(async (tx) => {
          const [existing] = await tx
            .select()
            .from(ledgerTxns)
            .where(eq(ledgerTxns.idempotencyKey, input.idempotencyKey));

          if (existing) {
            const existingEntries = await tx.select().from(ledgerEntries).where(eq(ledgerEntries.txnId, existing.id));
            return {
              id: existing.id,
              idempotencyKey: existing.idempotencyKey,
              eventType: existing.eventType,
              createdAt: existing.createdAt,
              entries: existingEntries.map((e) => ({
                id: e.id,
                txnId: e.txnId,
                accountId: e.accountId,
                currency: e.currency as LedgerCurrency,
                amount: e.amount,
              })),
            };
          }

          const [txnRow] = await tx
            .insert(ledgerTxns)
            .values({ idempotencyKey: input.idempotencyKey, eventType: input.eventType })
            .returning();

          const entryRows = [];
          for (const entry of input.entries) {
            let [account] = await tx
              .select()
              .from(ledgerAccounts)
              .where(
                and(
                  eq(ledgerAccounts.ownerType, entry.ownerType),
                  eq(ledgerAccounts.ownerId, entry.ownerId),
                  eq(ledgerAccounts.currency, entry.currency)
                )
              )
              .for("update");

            if (!account) {
              [account] = await tx
                .insert(ledgerAccounts)
                .values({ ownerType: entry.ownerType, ownerId: entry.ownerId, currency: entry.currency })
                .returning();
            }

            const [entryRow] = await tx
              .insert(ledgerEntries)
              .values({ txnId: txnRow.id, accountId: account.id, currency: entry.currency, amount: entry.amount })
              .returning();
            entryRows.push(entryRow);
          }

          return {
            id: txnRow.id,
            idempotencyKey: txnRow.idempotencyKey,
            eventType: txnRow.eventType,
            createdAt: txnRow.createdAt,
            entries: entryRows.map((e) => ({
              id: e.id,
              txnId: e.txnId,
              accountId: e.accountId,
              currency: e.currency as LedgerCurrency,
              amount: e.amount,
            })),
          };
        });
      },
      async getBalance(ownerType, ownerId, currency) {
        const [account] = await db
          .select()
          .from(ledgerAccounts)
          .where(and(eq(ledgerAccounts.ownerType, ownerType), eq(ledgerAccounts.ownerId, ownerId), eq(ledgerAccounts.currency, currency)));
        if (!account) return 0;
        const [row] = await db
          .select({ total: sum(ledgerEntries.amount) })
          .from(ledgerEntries)
          .where(eq(ledgerEntries.accountId, account.id));
        return Number(row?.total ?? 0);
      },
      async findAccount(ownerType, ownerId, currency) {
        const [account] = await db
          .select()
          .from(ledgerAccounts)
          .where(and(eq(ledgerAccounts.ownerType, ownerType), eq(ledgerAccounts.ownerId, ownerId), eq(ledgerAccounts.currency, currency)));
        return account ?? null;
      },
    },
    config: {
      async getLatest(key) {
        const rows = await db.select().from(appConfig).where(eq(appConfig.key, key)).orderBy(appConfig.version);
        if (rows.length === 0) return null;
        return rows[rows.length - 1];
      },
      async getVersion(key, version) {
        const [row] = await db.select().from(appConfig).where(and(eq(appConfig.key, key), eq(appConfig.version, version)));
        return row ?? null;
      },
    },
  };
}
```

This file has no test — it has no consumer that can run against a real database until Docker/Postgres exists (AGENTS.md §3.8: adapter contract tests run against the real implementation only with `RUN_VENDOR_TESTS=1`, once Postgres is reachable).

- [ ] **Step 6: Verify**

Run: `npm run typecheck` — `real.ts` must typecheck against the installed `drizzle-orm` API even though it cannot be executed yet.
Run: `npm test` — all fake tests still pass.

- [ ] **Step 7: Commit**

```bash
git add src/adapters/db
git commit -m "feat(adapters): add Database interface with fake and real (Postgres) implementations"
```

Report status `DONE_WITH_CONCERNS`: `real.ts` typechecks but has not been exercised against a live Postgres instance.

---

## Task 5: `src/modules/ledger` — post, balance, escrowFor

**Files:**
- Create: `src/modules/ledger/ledger.ts`
- Create: `src/modules/ledger/ledger.test.ts`

**Interfaces:**
- Consumes: `Database`, `LedgerOwnerType`, `LedgerCurrency`, `LedgerImbalanceError` from `src/adapters/db/types.ts`; `createFakeDatabase` from `src/adapters/db/fake.ts`.
- Produces: `post(deps, input): Promise<LedgerTxnRecord>`, `balance(deps, ownerType, ownerId, currency): Promise<number>`, `escrowFor(requestId): { ownerType: "escrow"; ownerId: string }` — the public ledger interface every later phase's `requests`/`rewards` modules call.

- [ ] **Step 1: Write the failing tests**

Create `src/modules/ledger/ledger.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createFakeDatabase } from "../../adapters/db/fake";
import { post, balance, escrowFor, type LedgerDeps } from "./ledger";
import { LedgerImbalanceError } from "../../adapters/db/types";

describe("ledger.post", () => {
  let deps: LedgerDeps;

  beforeEach(() => {
    const { db } = createFakeDatabase();
    deps = { db };
  });

  it("posts a balanced transaction", async () => {
    const txn = await post(deps, {
      idempotencyKey: "test:1",
      eventType: "credits.purchase",
      entries: [
        { ownerType: "platform", ownerId: "platform", currency: "credits", amount: -10 },
        { ownerType: "seeker", ownerId: "seeker-1", currency: "credits", amount: 10 },
      ],
    });
    expect(txn.entries).toHaveLength(2);
    expect(await balance(deps, "seeker", "seeker-1", "credits")).toBe(10);
    expect(await balance(deps, "platform", "platform", "credits")).toBe(-10);
  });

  it("rejects an imbalanced transaction and posts nothing", async () => {
    await expect(
      post(deps, {
        idempotencyKey: "test:2",
        eventType: "credits.purchase",
        entries: [
          { ownerType: "platform", ownerId: "platform", currency: "credits", amount: -10 },
          { ownerType: "seeker", ownerId: "seeker-1", currency: "credits", amount: 5 },
        ],
      })
    ).rejects.toThrow(LedgerImbalanceError);
    expect(await balance(deps, "seeker", "seeker-1", "credits")).toBe(0);
  });

  it("rejects a transaction with no entries", async () => {
    await expect(post(deps, { idempotencyKey: "test:empty", eventType: "x", entries: [] })).rejects.toThrow();
  });

  it("validates each currency independently", async () => {
    await expect(
      post(deps, {
        idempotencyKey: "test:3",
        eventType: "request.send",
        entries: [
          { ownerType: "seeker", ownerId: "s1", currency: "credits", amount: -2 },
          { ownerType: "escrow", ownerId: "req-1", currency: "credits", amount: 2 },
          { ownerType: "platform", ownerId: "platform", currency: "points", amount: -1 },
        ],
      })
    ).rejects.toThrow(LedgerImbalanceError);
  });

  it("is idempotent on repeated idempotency key", async () => {
    const input = {
      idempotencyKey: "request:req-1:send",
      eventType: "request.send",
      entries: [
        { ownerType: "seeker" as const, ownerId: "s1", currency: "credits" as const, amount: -2 },
        { ownerType: "escrow" as const, ownerId: "req-1", currency: "credits" as const, amount: 2 },
      ],
    };
    const first = await post(deps, input);
    const second = await post(deps, input);
    expect(second.id).toBe(first.id);
    expect(await balance(deps, "escrow", "req-1", "credits")).toBe(2);
  });

  it("computes the escrow account identity from a request id", () => {
    expect(escrowFor("req-42")).toEqual({ ownerType: "escrow", ownerId: "req-42" });
  });

  it("returns 0 for an account with no postings", async () => {
    expect(await balance(deps, "insider", "unseen", "points")).toBe(0);
  });

  it("property: random balanced posting sequences always leave a global zero sum per currency", async () => {
    const owners = ["a", "b", "c", "d", "e"] as const;
    const currencies = ["credits", "points"] as const;
    let seed = 42;
    function nextRandom(): number {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    }

    for (let i = 0; i < 50; i++) {
      const currency = currencies[Math.floor(nextRandom() * currencies.length)];
      const a = owners[Math.floor(nextRandom() * owners.length)];
      let b = owners[Math.floor(nextRandom() * owners.length)];
      while (b === a) b = owners[Math.floor(nextRandom() * owners.length)];
      const amount = Math.floor(nextRandom() * 20) + 1;

      await post(deps, {
        idempotencyKey: `random:${i}`,
        eventType: "test.random",
        entries: [
          { ownerType: "platform", ownerId: a, currency, amount: -amount },
          { ownerType: "platform", ownerId: b, currency, amount },
        ],
      });

      let total = 0;
      for (const owner of owners) total += await balance(deps, "platform", owner, currency);
      expect(total).toBe(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/ledger/ledger.test.ts`
Expected: FAIL — `./ledger` does not exist yet.

- [ ] **Step 3: Write `src/modules/ledger/ledger.ts`**

```ts
import type { Database, LedgerCurrency, LedgerOwnerType, LedgerTxnRecord } from "../../adapters/db/types";
import { LedgerImbalanceError } from "../../adapters/db/types";

export { LedgerImbalanceError };

export interface LedgerEntryInput {
  ownerType: LedgerOwnerType;
  ownerId: string;
  currency: LedgerCurrency;
  amount: number;
}

export interface PostTxnInput {
  idempotencyKey: string;
  eventType: string;
  entries: LedgerEntryInput[];
}

export interface LedgerDeps {
  db: Database;
}

function assertZeroSumPerCurrency(entries: LedgerEntryInput[]): void {
  const sums = new Map<LedgerCurrency, number>();
  for (const entry of entries) sums.set(entry.currency, (sums.get(entry.currency) ?? 0) + entry.amount);
  for (const [currency, total] of sums) {
    if (total !== 0) throw new LedgerImbalanceError(currency, total);
  }
}

export async function post(deps: LedgerDeps, input: PostTxnInput): Promise<LedgerTxnRecord> {
  if (input.entries.length === 0) {
    throw new Error("Ledger transaction must have at least one entry");
  }
  assertZeroSumPerCurrency(input.entries);
  return deps.db.ledger.postTxn(input);
}

export async function balance(
  deps: LedgerDeps,
  ownerType: LedgerOwnerType,
  ownerId: string,
  currency: LedgerCurrency
): Promise<number> {
  return deps.db.ledger.getBalance(ownerType, ownerId, currency);
}

export function escrowFor(requestId: string): { ownerType: "escrow"; ownerId: string } {
  return { ownerType: "escrow", ownerId: requestId };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/modules/ledger/ledger.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/ledger
git commit -m "feat(ledger): add pure post/balance/escrowFor module with zero-sum property test"
```

---

## Task 6: `src/modules/requests/state.ts` — the request transition table

**Files:**
- Create: `src/modules/requests/state.ts`
- Create: `src/modules/requests/state.test.ts`

**Interfaces:**
- Produces: `RequestState`, `RequestEvent`, `nextState(from, event)`, `canApply(from, event)`, `isTerminal(state)`, `InvalidTransitionError`, `ALL_STATES`, `ALL_EVENTS` — consumed by Phase 1's `requests.sendRequest`/`accept`/`decline`/etc. when they wire real persistence around this pure table.

- [ ] **Step 1: Write the failing tests**

Create `src/modules/requests/state.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  nextState,
  canApply,
  isTerminal,
  InvalidTransitionError,
  ALL_STATES,
  ALL_EVENTS,
  TERMINAL_STATES,
  type RequestState,
  type RequestEvent,
} from "./state";

const EXPECTED: Partial<Record<RequestState, Partial<Record<RequestEvent, RequestState>>>> = {
  SENT: { accept: "ACCEPTED", decline: "DECLINED", expire: "EXPIRED", cancel: "CANCELLED" },
  ACCEPTED: { proof: "PROOF_PENDING" },
  PROOF_PENDING: { reject: "ACCEPTED", verify: "SUBMITTED" },
  SUBMITTED: { interview: "INTERVIEW", windowExpiry: "NO_INTERVIEW" },
  INTERVIEW: { complete: "COMPLETE" },
  NO_INTERVIEW: { close: "CLOSED" },
};

describe("requests/state exhaustive transition table", () => {
  for (const state of ALL_STATES) {
    for (const event of ALL_EVENTS) {
      const expected = EXPECTED[state]?.[event];
      if (expected) {
        it(`${state} --${event}--> ${expected}`, () => {
          expect(nextState(state, event)).toBe(expected);
          expect(canApply(state, event)).toBe(true);
        });
      } else {
        it(`${state} --${event}--> rejected`, () => {
          expect(() => nextState(state, event)).toThrow(InvalidTransitionError);
          expect(canApply(state, event)).toBe(false);
        });
      }
    }
  }

  it("marks exactly the five terminal states", () => {
    for (const state of ALL_STATES) {
      expect(isTerminal(state)).toBe(TERMINAL_STATES.has(state));
    }
    expect([...TERMINAL_STATES].sort()).toEqual(["CANCELLED", "CLOSED", "COMPLETE", "DECLINED", "EXPIRED"]);
  });

  it("property: random walks from SENT never reach an undefined state, and terminal states admit no further events", () => {
    let seed = 7;
    function nextRandom(): number {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    }

    for (let run = 0; run < 50; run++) {
      let state: RequestState = "SENT";
      for (let step = 0; step < 20; step++) {
        if (isTerminal(state)) {
          for (const event of ALL_EVENTS) expect(canApply(state, event)).toBe(false);
          break;
        }
        const event = ALL_EVENTS[Math.floor(nextRandom() * ALL_EVENTS.length)];
        if (canApply(state, event)) {
          state = nextState(state, event);
          expect(ALL_STATES).toContain(state);
        } else {
          expect(() => nextState(state, event)).toThrow(InvalidTransitionError);
        }
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/requests/state.test.ts`
Expected: FAIL — `./state` does not exist yet.

- [ ] **Step 3: Write `src/modules/requests/state.ts`**

```ts
export type RequestState =
  | "SENT"
  | "ACCEPTED"
  | "DECLINED"
  | "EXPIRED"
  | "CANCELLED"
  | "PROOF_PENDING"
  | "SUBMITTED"
  | "INTERVIEW"
  | "COMPLETE"
  | "NO_INTERVIEW"
  | "CLOSED";

export type RequestEvent =
  | "accept"
  | "decline"
  | "expire"
  | "cancel"
  | "proof"
  | "reject"
  | "verify"
  | "interview"
  | "complete"
  | "windowExpiry"
  | "close";

export const TERMINAL_STATES: ReadonlySet<RequestState> = new Set([
  "DECLINED",
  "EXPIRED",
  "CANCELLED",
  "COMPLETE",
  "CLOSED",
]);

const TRANSITIONS: Record<RequestState, Partial<Record<RequestEvent, RequestState>>> = {
  SENT: { accept: "ACCEPTED", decline: "DECLINED", expire: "EXPIRED", cancel: "CANCELLED" },
  ACCEPTED: { proof: "PROOF_PENDING" },
  DECLINED: {},
  EXPIRED: {},
  CANCELLED: {},
  PROOF_PENDING: { reject: "ACCEPTED", verify: "SUBMITTED" },
  SUBMITTED: { interview: "INTERVIEW", windowExpiry: "NO_INTERVIEW" },
  INTERVIEW: { complete: "COMPLETE" },
  COMPLETE: {},
  NO_INTERVIEW: { close: "CLOSED" },
  CLOSED: {},
};

export class InvalidTransitionError extends Error {
  constructor(public readonly from: RequestState, public readonly event: RequestEvent) {
    super(`Cannot apply event "${event}" to request in state "${from}"`);
    this.name = "InvalidTransitionError";
  }
}

export function isTerminal(state: RequestState): boolean {
  return TERMINAL_STATES.has(state);
}

export function canApply(from: RequestState, event: RequestEvent): boolean {
  return TRANSITIONS[from]?.[event] !== undefined;
}

export function nextState(from: RequestState, event: RequestEvent): RequestState {
  const target = TRANSITIONS[from]?.[event];
  if (!target) throw new InvalidTransitionError(from, event);
  return target;
}

export const ALL_STATES = Object.keys(TRANSITIONS) as RequestState[];
export const ALL_EVENTS: RequestEvent[] = [
  "accept",
  "decline",
  "expire",
  "cancel",
  "proof",
  "reject",
  "verify",
  "interview",
  "complete",
  "windowExpiry",
  "close",
];
```

Note: AGENTS.md §1.5's diagram leaves the `INTERVIEW → COMPLETE` and `NO_INTERVIEW → CLOSED` arrows unlabeled. This task names them `complete` (final confirmation the loop closed successfully) and `close` (administrative closure of a no-interview outcome) since every transition needs an explicit event name; Phase 1's `requests.confirmInterview`/`closeWindow` functions are free to call these whatever is clearest at the call site as long as they pass the event names defined here.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/modules/requests/state.test.ts`
Expected: PASS (121 exhaustive transition cases + terminal-state check + property test = 123 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/requests
git commit -m "feat(requests): add pure request-state transition table with exhaustive and property tests"
```

---

## Task 7: `src/modules/config` — getRules/getPacks and the seed script

**Files:**
- Create: `src/modules/config/schemas.ts`
- Create: `src/modules/config/config.ts`
- Create: `src/modules/config/config.test.ts`
- Create: `scripts/seed.ts`
- Create: `scripts/migrate.ts`

**Interfaces:**
- Consumes: `Database`, `AppConfigRecord` from `src/adapters/db/types.ts`.
- Produces: `getRules(deps, version?): Promise<Rules>`, `getPacks(deps): Promise<CreditPack[]>`, `ConfigNotFoundError` — the config-not-code seam every later domain module reads business numbers through (AGENTS.md §0.5).

- [ ] **Step 1: Write `src/modules/config/schemas.ts`**

```ts
import { z } from "zod";

export const rulesSchema = z.object({
  responseWindowHours: z.number().int().positive(),
  interviewWindowDays: z.number().int().positive(),
  reverificationDays: z.number().int().positive(),
  tranche1Percent: z.number().min(0).max(100),
  tranche2Percent: z.number().min(0).max(100),
  refundPercentOnDecline: z.number().min(0).max(100),
  refundPercentOnExpiry: z.number().min(0).max(100),
  minRedemptionPoints: z.number().int().nonnegative(),
  panThresholdPoints: z.number().int().nonnegative(),
  freeCreditGrant: z.number().int().nonnegative(),
  requestCostByTier: z.record(z.string(), z.number().int().positive()),
});
export type Rules = z.infer<typeof rulesSchema>;

export const creditPackSchema = z.object({
  id: z.string(),
  credits: z.number().int().positive(),
  priceInPaise: z.number().int().positive(),
});
export type CreditPack = z.infer<typeof creditPackSchema>;

export const packsSchema = z.array(creditPackSchema);
```

- [ ] **Step 2: Write the failing tests**

Create `src/modules/config/config.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createFakeDatabase } from "../../adapters/db/fake";
import { getRules, getPacks, ConfigNotFoundError } from "./config";

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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/modules/config/config.test.ts`
Expected: FAIL — `./config` does not exist yet.

- [ ] **Step 4: Write `src/modules/config/config.ts`**

```ts
import type { Database } from "../../adapters/db/types";
import { rulesSchema, packsSchema, type Rules, type CreditPack } from "./schemas";

export interface ConfigDeps {
  db: Database;
}

export class ConfigNotFoundError extends Error {
  constructor(key: string, version?: number) {
    super(version ? `app_config "${key}" version ${version} not found` : `app_config "${key}" has no rows`);
    this.name = "ConfigNotFoundError";
  }
}

export async function getRules(deps: ConfigDeps, version?: number): Promise<Rules> {
  const row = version ? await deps.db.config.getVersion("rules", version) : await deps.db.config.getLatest("rules");
  if (!row) throw new ConfigNotFoundError("rules", version);
  return rulesSchema.parse(row.value);
}

export async function getPacks(deps: ConfigDeps): Promise<CreditPack[]> {
  const row = await deps.db.config.getLatest("credit_packs");
  if (!row) throw new ConfigNotFoundError("credit_packs");
  return packsSchema.parse(row.value);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/modules/config/config.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Write `scripts/migrate.ts` and `scripts/seed.ts`**

Create `scripts/migrate.ts`:
```ts
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { getEnv } from "../src/config/env";

async function main() {
  const env = getEnv();
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: "./drizzle/migrations" });
  await pool.end();
  console.log("Migrations applied.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Create `scripts/seed.ts`:
```ts
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
```

The rules values here intentionally match `RULES_V1` in `config.test.ts` so the seeded local dev database and the test fixtures describe the same placeholder business rules.

- [ ] **Step 7: Verify**

Run: `npm run typecheck` — `scripts/migrate.ts` and `scripts/seed.ts` must typecheck.
These scripts cannot run against a real database yet. Once Docker/Postgres is available: `npm run db:migrate && npm run db:seed`, then confirm via `psql $DATABASE_URL -c "select key, version, placeholder from app_config"` that both rows exist.

- [ ] **Step 8: Commit**

```bash
git add src/modules/config scripts
git commit -m "feat(config): add getRules/getPacks module and placeholder seed script"
```

Report status `DONE_WITH_CONCERNS` for the `scripts/*.ts` portion: not yet run against a real database.

---

## Task 8: `src/adapters/storage` and `src/adapters/email` — interfaces and fakes

**Files:**
- Create: `src/adapters/storage/types.ts`
- Create: `src/adapters/storage/fake.ts`
- Create: `src/adapters/storage/fake.test.ts`
- Create: `src/adapters/email/types.ts`
- Create: `src/adapters/email/fake.ts`
- Create: `src/adapters/email/fake.test.ts`

**Interfaces:**
- Produces: `StorageAdapter` (`createSignedUploadUrl`, `createSignedDownloadUrl`), `createFakeStorageAdapter()`; `EmailSender` (`send`), `createFakeEmailSender()` — consumed by Task 10 (`/api/health`) now and by Phase 1's `resumes`/`notifications` modules later.

- [ ] **Step 1: Write the failing storage tests**

Create `src/adapters/storage/fake.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createFakeStorageAdapter } from "./fake";

describe("createFakeStorageAdapter", () => {
  it("returns a signed upload url scoped to the bucket and object key", async () => {
    const storage = createFakeStorageAdapter();
    const result = await storage.createSignedUploadUrl("gn-resumes", "user-1/resume.pdf");
    expect(result.url).toContain("gn-resumes");
    expect(result.url).toContain("user-1/resume.pdf");
    expect(result.objectKey).toBe("user-1/resume.pdf");
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("returns a signed download url", async () => {
    const storage = createFakeStorageAdapter();
    const result = await storage.createSignedDownloadUrl("gn-proofs", "req-1/proof.png");
    expect(result.url).toContain("gn-proofs");
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/adapters/storage/fake.test.ts`
Expected: FAIL — `./fake` does not exist yet.

- [ ] **Step 3: Write `src/adapters/storage/types.ts` and `src/adapters/storage/fake.ts`**

`src/adapters/storage/types.ts`:
```ts
export interface SignedUploadUrl {
  url: string;
  expiresAt: Date;
  headers: Record<string, string>;
  objectKey: string;
}

export interface SignedDownloadUrl {
  url: string;
  expiresAt: Date;
}

export interface StorageAdapter {
  createSignedUploadUrl(bucket: string, objectKey: string): Promise<SignedUploadUrl>;
  createSignedDownloadUrl(bucket: string, objectKey: string): Promise<SignedDownloadUrl>;
}
```

`src/adapters/storage/fake.ts`:
```ts
import type { StorageAdapter } from "./types";

const TEN_MINUTES_MS = 10 * 60 * 1000;

export function createFakeStorageAdapter(): StorageAdapter {
  return {
    async createSignedUploadUrl(bucket, objectKey) {
      return {
        url: `https://fake-storage.local/${bucket}/${objectKey}?sig=fake-upload`,
        expiresAt: new Date(Date.now() + TEN_MINUTES_MS),
        headers: { "x-fake-upload": "true" },
        objectKey,
      };
    },
    async createSignedDownloadUrl(bucket, objectKey) {
      return {
        url: `https://fake-storage.local/${bucket}/${objectKey}?sig=fake-download`,
        expiresAt: new Date(Date.now() + TEN_MINUTES_MS),
      };
    },
  };
}
```

The real GCS-backed implementation is deferred to Phase 1, built alongside the `resumes` module that first needs it (AGENTS.md §3.11 Phase 1), matching the "real.ts written when the consuming module needs it" pattern already used for `db/real.ts` in Task 4.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/adapters/storage/fake.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing email tests**

Create `src/adapters/email/fake.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createFakeEmailSender } from "./fake";

describe("createFakeEmailSender", () => {
  it("records sent messages and returns a unique id per send", async () => {
    const { sender, sent } = createFakeEmailSender();
    const first = await sender.send({ to: "a@b.com", subject: "Hi", html: "<p>Hi</p>" });
    const second = await sender.send({ to: "c@d.com", subject: "Hi again", html: "<p>Hi</p>" });
    expect(sent).toHaveLength(2);
    expect(first.id).not.toBe(second.id);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/adapters/email/fake.test.ts`
Expected: FAIL — `./fake` does not exist yet.

- [ ] **Step 7: Write `src/adapters/email/types.ts` and `src/adapters/email/fake.ts`**

`src/adapters/email/types.ts`:
```ts
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<{ id: string }>;
}
```

`src/adapters/email/fake.ts`:
```ts
import type { EmailSender, EmailMessage } from "./types";

export function createFakeEmailSender(): { sender: EmailSender; sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  const sender: EmailSender = {
    async send(message) {
      sent.push(message);
      return { id: `fake-email-${sent.length}` };
    },
  };
  return { sender, sent };
}
```

The real Brevo-backed implementation is deferred to Phase 1's `notifications` module, which is the first consumer.

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run src/adapters/email/fake.test.ts`
Expected: PASS (1 test).

- [ ] **Step 9: Commit**

```bash
git add src/adapters/storage src/adapters/email
git commit -m "feat(adapters): add storage and email interfaces with fakes"
```

---

## Task 9: `src/jobs/queue` and the pg-boss worker entry

**Files:**
- Create: `src/jobs/queue.ts`
- Create: `src/jobs/queue.fake.ts`
- Create: `src/jobs/queue.fake.test.ts`
- Create: `src/jobs/queue.real.ts`
- Create: `src/jobs/worker.ts`
- Create: `src/jobs/worker.test.ts`
- Create: `src/jobs/run-worker.ts`

**Interfaces:**
- Produces: `QueueClient` (`start`, `stop`, `send`, `work`), `createFakeQueueClient()`, `createRealQueueClient(connectionString)`, `startWorker(queue): Promise<void>` — consumed by Task 10 (`/api/health`) now and by every Phase 1+ job handler later.

- [ ] **Step 1: Write `src/jobs/queue.ts`**

```ts
export interface JobHandler<T = unknown> {
  (payload: T): Promise<void>;
}

export interface QueueClient {
  start(): Promise<void>;
  stop(): Promise<void>;
  send(queueName: string, payload: unknown): Promise<string | null>;
  work(queueName: string, handler: JobHandler): Promise<void>;
}
```

- [ ] **Step 2: Write the failing fake-queue tests**

Create `src/jobs/queue.fake.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { createFakeQueueClient } from "./queue.fake";

describe("createFakeQueueClient", () => {
  it("returns null and does not enqueue when send is called before start", async () => {
    const queue = createFakeQueueClient();
    const result = await queue.send("resume.parse", { id: "r1" });
    expect(result).toBeNull();
  });

  it("delivers sent payloads to a registered handler once started", async () => {
    const queue = createFakeQueueClient();
    const handler = vi.fn(async () => {});
    await queue.work("resume.parse", handler);
    await queue.start();
    const jobId = await queue.send("resume.parse", { id: "r1" });
    expect(jobId).not.toBeNull();
    expect(handler).toHaveBeenCalledWith({ id: "r1" });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/jobs/queue.fake.test.ts`
Expected: FAIL — `./queue.fake` does not exist yet.

- [ ] **Step 4: Write `src/jobs/queue.fake.ts`**

```ts
import type { QueueClient, JobHandler } from "./queue";

export function createFakeQueueClient(): QueueClient {
  const queues: Record<string, unknown[]> = {};
  const handlers: Record<string, JobHandler> = {};
  let started = false;

  return {
    async start() {
      started = true;
    },
    async stop() {
      started = false;
    },
    async send(queueName, payload) {
      if (!started) return null;
      (queues[queueName] ??= []).push(payload);
      const handler = handlers[queueName];
      if (handler) await handler(payload);
      return `fake-job-${queues[queueName].length}`;
    },
    async work(queueName, handler) {
      handlers[queueName] = handler;
    },
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/jobs/queue.fake.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Write `src/jobs/queue.real.ts`**

```ts
import PgBoss from "pg-boss";
import type { QueueClient } from "./queue";

export function createRealQueueClient(connectionString: string): QueueClient {
  const boss = new PgBoss(connectionString);
  return {
    async start() {
      await boss.start();
    },
    async stop() {
      await boss.stop();
    },
    async send(queueName, payload) {
      return boss.send(queueName, payload as object);
    },
    async work(queueName, handler) {
      await boss.work(queueName, async (job) => {
        await handler(job.data);
      });
    },
  };
}
```

- [ ] **Step 7: Write the failing worker test**

Create `src/jobs/worker.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { startWorker } from "./worker";
import { createFakeQueueClient } from "./queue.fake";

describe("startWorker", () => {
  it("starts the queue client", async () => {
    const queue = createFakeQueueClient();
    const startSpy = vi.spyOn(queue, "start");
    await startWorker(queue);
    expect(startSpy).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 8: Run test to verify it fails**

Run: `npx vitest run src/jobs/worker.test.ts`
Expected: FAIL — `./worker` does not exist yet.

- [ ] **Step 9: Write `src/jobs/worker.ts` and `src/jobs/run-worker.ts`**

`src/jobs/worker.ts` (pure — no side effects at import time, so it is safely testable):
```ts
import type { QueueClient } from "./queue";

export async function startWorker(queue: QueueClient): Promise<void> {
  await queue.start();
  console.log("[worker] started, no job handlers registered yet (Phase 1+)");
}
```

`src/jobs/run-worker.ts` (the executable entry point `npm run worker:dev` points to; not imported by anything else, so its side effects at load time are fine):
```ts
import { getEnv } from "../config/env";
import { createRealQueueClient } from "./queue.real";
import { startWorker } from "./worker";

const env = getEnv();
const queue = createRealQueueClient(env.DATABASE_URL);

startWorker(queue).catch((err) => {
  console.error("[worker] failed to start", err);
  process.exit(1);
});
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `npx vitest run src/jobs/worker.test.ts`
Expected: PASS (1 test).
Run: `npm run typecheck` — `queue.real.ts` and `run-worker.ts` must typecheck against `pg-boss`'s installed types even though they cannot be executed without a live Postgres.

- [ ] **Step 11: Commit**

```bash
git add src/jobs
git commit -m "feat(jobs): add QueueClient interface, fake/real pg-boss implementations, and worker entry"
```

Report status `DONE_WITH_CONCERNS`: `queue.real.ts`/`run-worker.ts` typecheck but have not been run against a live Postgres.

---

## Task 10: `/api/health`

**Files:**
- Create: `src/lib/health.ts`
- Create: `src/lib/health.test.ts`
- Create: `app/api/health/route.ts`

**Interfaces:**
- Consumes: `Database` (Task 4), `StorageAdapter` (Task 8), `QueueClient` (Task 9), and their fakes.
- Produces: `getHealthReport(deps): Promise<HealthReport>` and the `GET /api/health` route AGENTS.md §3.5/§1.2 requires for the CI deploy gate and uptime checks.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/health.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { getHealthReport } from "./health";
import { createFakeDatabase } from "../adapters/db/fake";
import { createFakeStorageAdapter } from "../adapters/storage/fake";
import { createFakeQueueClient } from "../jobs/queue.fake";

describe("getHealthReport", () => {
  it("reports ok when all checks pass", async () => {
    const { db } = createFakeDatabase();
    const storage = createFakeStorageAdapter();
    const queue = createFakeQueueClient();
    await queue.start();

    const report = await getHealthReport({ db, storage, queue });

    expect(report.ok).toBe(true);
    expect(report.checks.map((c) => c.name)).toEqual(["db", "storage", "queue"]);
  });

  it("reports not ok when a check fails, without leaking other checks' failures", async () => {
    const { db } = createFakeDatabase();
    const queue = createFakeQueueClient();
    await queue.start();
    const failingStorage = {
      async createSignedUploadUrl(): Promise<never> {
        throw new Error("bucket unreachable");
      },
      async createSignedDownloadUrl(): Promise<never> {
        throw new Error("bucket unreachable");
      },
    };

    const report = await getHealthReport({ db, storage: failingStorage, queue });

    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.name === "storage")?.ok).toBe(false);
    expect(report.checks.find((c) => c.name === "db")?.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/health.test.ts`
Expected: FAIL — `./health` does not exist yet.

- [ ] **Step 3: Write `src/lib/health.ts`**

```ts
import type { Database } from "../adapters/db/types";
import type { StorageAdapter } from "../adapters/storage/types";
import type { QueueClient } from "../jobs/queue";

export interface HealthCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface HealthReport {
  ok: boolean;
  checks: HealthCheck[];
}

export interface HealthDeps {
  db: Database;
  storage: StorageAdapter;
  queue: QueueClient;
}

function toDetail(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function checkDb(db: Database): Promise<HealthCheck> {
  try {
    await db.config.getLatest("__health_probe__");
    return { name: "db", ok: true };
  } catch (err) {
    return { name: "db", ok: false, detail: toDetail(err) };
  }
}

async function checkStorage(storage: StorageAdapter): Promise<HealthCheck> {
  try {
    await storage.createSignedUploadUrl("health-check", "probe");
    return { name: "storage", ok: true };
  } catch (err) {
    return { name: "storage", ok: false, detail: toDetail(err) };
  }
}

async function checkQueue(queue: QueueClient): Promise<HealthCheck> {
  try {
    await queue.send("__health_probe__", { at: Date.now() });
    return { name: "queue", ok: true };
  } catch (err) {
    return { name: "queue", ok: false, detail: toDetail(err) };
  }
}

export async function getHealthReport(deps: HealthDeps): Promise<HealthReport> {
  const checks = await Promise.all([checkDb(deps.db), checkStorage(deps.storage), checkQueue(deps.queue)]);
  return { ok: checks.every((c) => c.ok), checks };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/health.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write `app/api/health/route.ts`**

```ts
import { getHealthReport } from "@/src/lib/health";
import { createFakeDatabase } from "@/src/adapters/db/fake";
import { createFakeStorageAdapter } from "@/src/adapters/storage/fake";
import { createFakeQueueClient } from "@/src/jobs/queue.fake";

export async function GET() {
  // Phase 0 wires fakes directly; Phase 1 introduces a src/lib/adapters.ts
  // factory that switches on env.ADAPTERS ("fake" | "real") once real.ts
  // implementations exist for storage and the queue.
  const { db } = createFakeDatabase();
  const storage = createFakeStorageAdapter();
  const queue = createFakeQueueClient();
  await queue.start();

  const report = await getHealthReport({ db, storage, queue });
  return Response.json(report, { status: report.ok ? 200 : 503 });
}
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck`
Run: `npm test` — full suite still passes.
Start the dev server and confirm the route responds: run `npm run dev` in the background, then `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/health` — expect `200`. Stop the dev server afterward.

- [ ] **Step 7: Commit**

```bash
git add src/lib/health.ts src/lib/health.test.ts app/api/health
git commit -m "feat(health): add /api/health backed by db, storage, and queue checks"
```

---

## Task 11: `src/lib/ratelimit.ts`

**Files:**
- Create: `src/lib/ratelimit.ts`
- Create: `src/lib/ratelimit.test.ts`

**Interfaces:**
- Produces: `RateLimiter` (`check(key): boolean`), `createInMemoryRateLimiter(maxRequests?, windowMs?)` — consumed by Task 12's rewritten waitlist/survey routes now, and replaceable by a Redis-backed implementation later without changing callers (AGENTS.md §3.5).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/ratelimit.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createInMemoryRateLimiter } from "./ratelimit";

describe("createInMemoryRateLimiter", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("allows up to maxRequests within the window", () => {
    const limiter = createInMemoryRateLimiter(3, 60_000);
    expect(limiter.check("ip-1")).toBe(true);
    expect(limiter.check("ip-1")).toBe(true);
    expect(limiter.check("ip-1")).toBe(true);
    expect(limiter.check("ip-1")).toBe(false);
  });

  it("tracks keys independently", () => {
    const limiter = createInMemoryRateLimiter(1, 60_000);
    expect(limiter.check("ip-1")).toBe(true);
    expect(limiter.check("ip-2")).toBe(true);
    expect(limiter.check("ip-1")).toBe(false);
  });

  it("allows requests again once the window passes", () => {
    const limiter = createInMemoryRateLimiter(1, 60_000);
    expect(limiter.check("ip-1")).toBe(true);
    expect(limiter.check("ip-1")).toBe(false);
    vi.advanceTimersByTime(60_001);
    expect(limiter.check("ip-1")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/ratelimit.test.ts`
Expected: FAIL — `./ratelimit` does not exist yet.

- [ ] **Step 3: Write `src/lib/ratelimit.ts`**

```ts
export interface RateLimiter {
  check(key: string): boolean;
}

export function createInMemoryRateLimiter(maxRequests = 5, windowMs = 60_000): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    check(key: string): boolean {
      const now = Date.now();
      const windowStart = now - windowMs;
      const recent = (hits.get(key) ?? []).filter((t) => t > windowStart);
      if (recent.length >= maxRequests) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      return true;
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/ratelimit.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ratelimit.ts src/lib/ratelimit.test.ts
git commit -m "feat(lib): add in-memory rate limiter behind a swappable interface"
```

---

## Task 12: Remove known defects — `lib/api-security.ts`, waitlist/survey routes, `lib/gas.ts`

**Files:**
- Delete: `lib/api-security.ts`
- Create: `src/lib/same-origin.ts`
- Create: `src/lib/same-origin.test.ts`
- Modify: `app/api/waitlist/route.ts`
- Create: `app/api/waitlist/route.test.ts`
- Modify: `app/api/survey/route.ts`
- Create: `app/api/survey/route.test.ts`
- Modify: `lib/gas.ts`

**Interfaces:**
- Consumes: `createInMemoryRateLimiter` from `src/lib/ratelimit.ts` (Task 11).
- Produces: `isSameOrigin(req): boolean` from `src/lib/same-origin.ts`.

This directly implements AGENTS.md §3.9: delete `lib/api-security.ts` (its "secret" is exposed as `NEXT_PUBLIC_API_SECRET` and its rate limiter is an in-memory `Map` with no window eviction discipline); replace with same-origin checks, a honeypot field, and `src/lib/ratelimit.ts`; remove the `_debug` fields both routes return. It also maps the wire-level `userType` values to locked vocabulary (`seeker`/`insider`, never `job_seeker`/`referrer` — AGENTS.md §0.4). The frontend counterpart (removing the `x-api-secret` header send and adding the honeypot input) is Task 9 of the companion frontend plan.

- [ ] **Step 1: Write the failing same-origin test**

Create `src/lib/same-origin.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { isSameOrigin } from "./same-origin";

function makeRequest(headers: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost:3000/api/waitlist", { method: "POST", headers });
}

describe("isSameOrigin", () => {
  it("allows a request whose Origin host matches the request Host", () => {
    expect(isSameOrigin(makeRequest({ origin: "http://localhost:3000", host: "localhost:3000" }))).toBe(true);
  });

  it("rejects a request whose Origin host differs from the request Host", () => {
    expect(isSameOrigin(makeRequest({ origin: "http://evil.example", host: "localhost:3000" }))).toBe(false);
  });

  it("allows a request with no Origin header (defense in depth handles the rest)", () => {
    expect(isSameOrigin(makeRequest({ host: "localhost:3000" }))).toBe(true);
  });

  it("rejects a request with a malformed Origin header", () => {
    expect(isSameOrigin(makeRequest({ origin: "not-a-url", host: "localhost:3000" }))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/same-origin.test.ts`
Expected: FAIL — `./same-origin` does not exist yet.

- [ ] **Step 3: Write `src/lib/same-origin.ts`**

```ts
import type { NextRequest } from "next/server";

export function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/same-origin.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Delete `lib/api-security.ts`**

```bash
git rm lib/api-security.ts
```

- [ ] **Step 6: Write the failing waitlist route test**

Create `app/api/waitlist/route.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

vi.mock("@/lib/brevo", () => ({ addToBrevo: vi.fn(async () => ({ ok: true })) }));

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3000/api/waitlist", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", host: "localhost:3000", ...headers },
  });
}

describe("POST /api/waitlist", () => {
  it("accepts a same-origin request with a valid email", async () => {
    const res = await POST(makeRequest({ email: "a@b.com", userType: "seeker" }, { origin: "http://localhost:3000" }));
    expect(res.status).toBe(200);
  });

  it("rejects a cross-origin request", async () => {
    const res = await POST(makeRequest({ email: "a@b.com" }, { origin: "http://evil.example" }));
    expect(res.status).toBe(403);
  });

  it("silently accepts but skips Brevo when the honeypot field is filled", async () => {
    const { addToBrevo } = await import("@/lib/brevo");
    const res = await POST(makeRequest({ email: "a@b.com", website: "http://spam.example" }, { origin: "http://localhost:3000" }));
    expect(res.status).toBe(200);
    expect(addToBrevo).not.toHaveBeenCalled();
  });

  it("rejects an invalid email", async () => {
    const res = await POST(makeRequest({ email: "not-an-email" }, { origin: "http://localhost:3000" }));
    expect(res.status).toBe(400);
  });

  it("never includes a _debug field in the response body", async () => {
    const res = await POST(makeRequest({ email: "a@b.com" }, { origin: "http://localhost:3000" }));
    const body = await res.json();
    expect(body._debug).toBeUndefined();
  });

  it("maps userType to locked-vocabulary values, defaulting to seeker", async () => {
    const { addToBrevo } = await import("@/lib/brevo");
    await POST(makeRequest({ email: "a@b.com", userType: "insider" }, { origin: "http://localhost:3000" }));
    expect(addToBrevo).toHaveBeenCalledWith("a@b.com", expect.objectContaining({ USER_TYPE: "insider" }));
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run app/api/waitlist/route.test.ts`
Expected: FAIL — the existing route still imports the deleted `@/lib/api-security` and does not implement same-origin/honeypot behavior.

- [ ] **Step 8: Rewrite `app/api/waitlist/route.ts`**

```ts
import { NextRequest } from "next/server";
import { addToBrevo } from "@/lib/brevo";
import { isSameOrigin } from "@/src/lib/same-origin";
import { createInMemoryRateLimiter } from "@/src/lib/ratelimit";

const rateLimiter = createInMemoryRateLimiter(5, 60_000);

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  if (!rateLimiter.check(ip)) {
    return Response.json({ error: "Too many requests" }, { status: 429 });
  }

  try {
    const body = await req.json();
    const { email, userType, whatsapp, website } = body as {
      email: string;
      userType?: string;
      whatsapp?: string;
      website?: string;
    };

    if (website) {
      // Honeypot: bots fill hidden fields real users never see. Accept silently, do nothing.
      return Response.json({ success: true });
    }

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return Response.json({ error: "Invalid email" }, { status: 400 });
    }

    const resolvedType = userType === "insider" ? "insider" : "seeker";

    const result = await addToBrevo(email.trim().toLowerCase(), {
      USER_TYPE: resolvedType,
      SOURCE: "landing_page",
      ...(whatsapp ? { WHATSAPP: whatsapp } : {}),
    });

    if (!result.ok) {
      console.error("[waitlist] Brevo failed:", result.reason, "| status:", result.status);
      return Response.json({ success: true, warning: "Subscribed locally; email provider error logged" });
    }

    return Response.json({ success: true });
  } catch (err) {
    console.error("[waitlist] Unhandled error:", err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npx vitest run app/api/waitlist/route.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 10: Write the failing survey route test**

Create `app/api/survey/route.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

vi.mock("@/lib/gas", () => ({ submitToSheets: vi.fn(async () => ({ ok: true })) }));

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3000/api/survey", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", host: "localhost:3000", ...headers },
  });
}

describe("POST /api/survey", () => {
  it("accepts a same-origin request with valid answers", async () => {
    const res = await POST(
      makeRequest({ answers: { q1: "yes" }, submittedAt: "2026-01-01T00:00:00Z" }, { origin: "http://localhost:3000" })
    );
    expect(res.status).toBe(200);
  });

  it("rejects a cross-origin request", async () => {
    const res = await POST(makeRequest({ answers: {}, submittedAt: "x" }, { origin: "http://evil.example" }));
    expect(res.status).toBe(403);
  });

  it("rejects an invalid payload", async () => {
    const res = await POST(makeRequest({ answers: "not-an-object" }, { origin: "http://localhost:3000" }));
    expect(res.status).toBe(400);
  });

  it("silently accepts but skips submission when the honeypot field is filled", async () => {
    const { submitToSheets } = await import("@/lib/gas");
    const res = await POST(
      makeRequest({ answers: { q1: "yes" }, submittedAt: "x", website: "http://spam.example" }, { origin: "http://localhost:3000" })
    );
    expect(res.status).toBe(200);
    expect(submitToSheets).not.toHaveBeenCalled();
  });

  it("never includes a _debug field in the response body", async () => {
    const res = await POST(makeRequest({ answers: { q1: "yes" }, submittedAt: "x" }, { origin: "http://localhost:3000" }));
    const body = await res.json();
    expect(body._debug).toBeUndefined();
  });
});
```

- [ ] **Step 11: Run test to verify it fails**

Run: `npx vitest run app/api/survey/route.test.ts`
Expected: FAIL — the existing route still imports the deleted `@/lib/api-security`.

- [ ] **Step 12: Rewrite `app/api/survey/route.ts`**

```ts
import { NextRequest } from "next/server";
import { submitToSheets } from "@/lib/gas";
import { isSameOrigin } from "@/src/lib/same-origin";
import { createInMemoryRateLimiter } from "@/src/lib/ratelimit";

const rateLimiter = createInMemoryRateLimiter(5, 60_000);

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  if (!rateLimiter.check(ip)) {
    return Response.json({ error: "Too many requests" }, { status: 429 });
  }

  try {
    const body = await req.json();
    const { answers, submittedAt, website } = body as {
      answers: Record<string, unknown>;
      submittedAt: string;
      website?: string;
    };

    if (website) {
      return Response.json({ success: true });
    }

    if (!answers || typeof answers !== "object") {
      return Response.json({ error: "Invalid payload" }, { status: 400 });
    }

    const result = await submitToSheets({ answers, submittedAt });

    if (!result.ok) {
      console.error("[survey] GAS failed:", result.reason, "| status:", result.status);
      return Response.json({ success: true, warning: "Response logged; Sheets write failed" });
    }

    return Response.json({ success: true });
  } catch (err) {
    console.error("[survey] Unhandled error:", err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
```

- [ ] **Step 13: Run tests to verify they pass**

Run: `npx vitest run app/api/survey/route.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 14: Fix `lib/gas.ts`**

In `lib/gas.ts`, remove the line `secret: process.env.NEXT_PUBLIC_API_SECRET,` from the request body (same-origin checking on the route now replaces the client-supplied "secret"):
```ts
      body: JSON.stringify({
        ...( data as object ),
      }),
```

- [ ] **Step 15: Run the full backend test suite**

Run: `npm test`
Expected: PASS — every test across Tasks 1–12 still passes.
Run: `npm run typecheck` and `npm run lint` — both clean.

- [ ] **Step 16: Commit**

```bash
git add -A lib app/api src/lib
git commit -m "fix(security): remove NEXT_PUBLIC_API_SECRET, replace with same-origin check, honeypot, and rate limiting"
```

---

## Task 13: Infra — Dockerfile, compose files, Caddyfile

**Files:**
- Modify: `next.config.ts`
- Create: `infra/Dockerfile`
- Create: `infra/compose.dev.yml`
- Create: `infra/compose.prod.yml`
- Create: `infra/Caddyfile`

**Interfaces:** none (infra files; no TypeScript consumers).

This task cannot be runtime-verified in this session — Docker is not installed (Global Constraints). Verification here is limited to syntax review; once Docker Desktop is installed, run the commands in Step 5.

- [ ] **Step 1: Set standalone output in `next.config.ts`**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
```

- [ ] **Step 2: Write `infra/Dockerfile`**

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/src ./src
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/next.config.ts ./next.config.ts
EXPOSE 3000
CMD ["npm", "run", "start"]
```

`web` and `worker` share this image (AGENTS.md §1.1): the `worker` service in `compose.prod.yml` overrides `command` to run `src/jobs/run-worker.ts` via `tsx` instead of `npm run start`, since both the full `node_modules` (including `tsx`, `pg-boss`, `drizzle-orm`) and `src/` are present in the runtime stage.

- [ ] **Step 3: Write `infra/compose.dev.yml`**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: getnudgd
      POSTGRES_PASSWORD: getnudgd
      POSTGRES_DB: getnudgd
    ports:
      - "5432:5432"
    volumes:
      - getnudgd-postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U getnudgd"]
      interval: 5s
      timeout: 5s
      retries: 10

  gotenberg:
    image: gotenberg/gotenberg:8
    ports:
      - "3050:3000"

volumes:
  getnudgd-postgres-data:
```

- [ ] **Step 4: Write `infra/compose.prod.yml` and `infra/Caddyfile`**

`infra/compose.prod.yml`:
```yaml
services:
  caddy:
    image: caddy:2-alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy-data:/data
    depends_on:
      - web

  web:
    build:
      context: ../
      dockerfile: infra/Dockerfile
    env_file:
      - ../.env
    expose:
      - "3000"

  worker:
    build:
      context: ../
      dockerfile: infra/Dockerfile
    command: ["npx", "tsx", "src/jobs/run-worker.ts"]
    env_file:
      - ../.env

  gotenberg:
    image: gotenberg/gotenberg:8
    expose:
      - "3000"

volumes:
  caddy-data:
```

`infra/Caddyfile`:
```
{$APP_DOMAIN} {
	reverse_proxy web:3000
}

admin.{$APP_DOMAIN} {
	@allowed remote_ip {$ADMIN_IP_ALLOWLIST}
	handle @allowed {
		reverse_proxy web:3000
	}
	respond 403
}
```

- [ ] **Step 5: Verify (deferred)**

Cannot run now — Docker is not installed. Once Docker Desktop is installed, verify with:
```bash
docker compose -f infra/compose.dev.yml config
docker compose -f infra/compose.prod.yml config
docker build -f infra/Dockerfile -t getnudgd:phase-0 .
docker compose -f infra/compose.dev.yml up -d
curl -s http://localhost:3050/health   # Gotenberg
```
For now: read every YAML/Dockerfile file back and confirm indentation and image tags are correct (`postgres:16-alpine`, `gotenberg/gotenberg:8`, `caddy:2-alpine`, `node:22-alpine`).

- [ ] **Step 6: Commit**

```bash
git add next.config.ts infra
git commit -m "feat(infra): add Dockerfile, dev/prod compose files, and Caddyfile"
```

Report status `DONE_WITH_CONCERNS`: none of this has been built or run — Docker is not yet installed on the founder's machine. Flag this to the controller so it gets verified in a follow-up once Docker Desktop is available.

---

## Task 14: CI pipeline

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:** none.

Scope note: AGENTS.md §1.2's full CI/CD table (build image → push → SSH deploy → migrate → health gate → rollback) needs a real deploy target (VPS, SSH secrets, registry) that doesn't exist yet. This task delivers the portion Phase 0 can actually stand behind — lint, typecheck, test, build — on every push and PR. The deploy stages are added once `infra/` (Task 13) is verified against a running Docker setup and a VPS/registry exist, in a later phase.

- [ ] **Step 1: Write `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
```

- [ ] **Step 2: Verify locally**

Run each command the workflow runs, in order, exactly as CI would:
```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```
Expected: all five succeed. (The workflow itself cannot be executed locally without GitHub Actions or `act`; running the same commands locally is the achievable verification bar until this is pushed.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add lint, typecheck, test, and build workflow"
```

---

## Plan Self-Review Notes

- **Spec coverage:** every bullet in AGENTS.md §3.11 Phase 0 backend backlog has a task — repo restructure/Dockerfile (Task 13, plus directory creation folded into the task that first needs each directory per the "fold setup into the task whose deliverable needs it" rule), env.ts+brand.ts (Task 2), Drizzle schema+migration (Task 3), ledger (Task 5), requests/state (Task 6), config loader+seed (Task 7), adapter interfaces+fakes (Tasks 4, 8), `/api/health` (Task 10), pg-boss worker entry (Task 9 — sequenced before Task 10 since health-checking the queue requires the queue client to exist, reordered from AGENTS.md's literal listing for this dependency reason), CI pipeline (Task 14), known defects removed (Task 12).
- **Deliberately deferred, with rationale stated in Global Constraints:** payments/WhatsApp/LLM/docgen/gift-card adapters (no Phase 0/1-start consumer yet); real GCS storage and real Brevo email implementations (built alongside their first consuming module in Phase 1); `request_events`/`admin_audit_log` append-only tables (no writer exists until Phase 1's `requests`/`admin` modules); full CI/CD deploy pipeline (no VPS/registry/SSH secrets exist yet).
- **Verification debt:** Tasks 3, 4 (`real.ts`), 7 (`scripts/*.ts`), 9 (`queue.real.ts`/`run-worker.ts`), and 13 (all of `infra/`) type-check and read correctly but cannot be exercised against a live Postgres/Docker in this session. Each task's report says `DONE_WITH_CONCERNS` for this reason. Once the founder installs Docker Desktop, the controller should dispatch a short follow-up task that runs `docker compose -f infra/compose.dev.yml up -d`, `npm run db:migrate`, `npm run db:seed`, and the adapter contract tests with `RUN_VENDOR_TESTS=1` to close out this debt — this is not a new task in this plan because it is pure verification of code already written, not new implementation.
