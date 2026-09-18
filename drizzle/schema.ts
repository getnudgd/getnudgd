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
