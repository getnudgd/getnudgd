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
