import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { getEnv } from "../config/env";
import type { Database } from "../adapters/db/types";
import { createFakeDatabase } from "../adapters/db/fake";
import { createRealDatabase } from "../adapters/db/real";
import type { QueueClient } from "../jobs/queue";
import { createFakeQueueClient } from "../jobs/queue.fake";
import { createRealQueueClient } from "../jobs/queue.real";
import type { AuthAdapter } from "../adapters/auth/types";
import { createFakeAuthAdapter } from "../adapters/auth/fake";
import { createRefusingAuthAdapter } from "../adapters/auth/refusing";
import type { StorageAdapter } from "../adapters/storage/types";
import { createFakeStorageAdapter } from "../adapters/storage/fake";
import type { EmailSender } from "../adapters/email/types";
import { createFakeEmailSender } from "../adapters/email/fake";
import type { WhatsAppGateway } from "../adapters/whatsapp/types";
import { createFakeWhatsAppGateway } from "../adapters/whatsapp/fake";
import type { GiftCardVendor } from "../adapters/giftcards/types";
import { createManualFulfilmentVendor } from "../adapters/giftcards/manual";

export interface Adapters {
  db: Database;
  queue: QueueClient;
  auth: AuthAdapter;
  storage: StorageAdapter;
  email: EmailSender;
  whatsapp: WhatsAppGateway;
  giftCards: GiftCardVendor;
}

let cached: Adapters | undefined;

/**
 * The single place the app picks fake vs. real adapters, based on env.ADAPTERS.
 * auth/storage/email/whatsapp have no real.ts implementation yet (Firebase, Cloud Storage,
 * and Brevo are deferred; WhatsAppGateway has only a fake in this plan) — they
 * always use fakes until those land, regardless of ADAPTERS, with one
 * exception: auth uses a refusing adapter (src/adapters/auth/refusing.ts)
 * whenever NODE_ENV=production, so a production deployment can never accept
 * the fake adapter's forged tokens even before a real Firebase adapter exists.
 * giftCards always uses the manual fulfilment vendor (the founder
 * fulfils redemptions by hand from `/admin`); there is no fake/real split for
 * it yet since there is no third-party gift-card vendor integrated. Memoized:
 * the underlying Pool/QueueClient are constructed once and reused across calls
 * within this process.
 *
 * This file intentionally does NOT import "server-only": it is imported directly
 * by the pg-boss worker process (src/jobs/run-worker.ts), which runs under plain
 * Node/tsx, not inside Next's react-server build condition. The "server-only"
 * package's export map only resolves to a no-op under that condition; under
 * plain Node it resolves to a module that throws at import time. App/Next.js
 * code should import the adapters via ../lib/adapters (the thin re-export that
 * does carry the "server-only" guard), not this file directly.
 */
export function getAdapters(): Adapters {
  if (cached) return cached;
  const env = getEnv();

  const db: Database =
    env.ADAPTERS === "real"
      ? createRealDatabase(drizzle(new Pool({ connectionString: env.DATABASE_URL })))
      : createFakeDatabase().db;

  const queue: QueueClient =
    env.ADAPTERS === "real" ? createRealQueueClient(env.DATABASE_URL) : createFakeQueueClient();

  const auth: AuthAdapter =
    env.NODE_ENV === "production" ? createRefusingAuthAdapter().adapter : createFakeAuthAdapter().adapter;
  const storage: StorageAdapter = createFakeStorageAdapter();
  const email: EmailSender = createFakeEmailSender().sender;

  const whatsapp: WhatsAppGateway = createFakeWhatsAppGateway().gateway;
  const giftCards: GiftCardVendor = createManualFulfilmentVendor();

  cached = { db, queue, auth, storage, email, whatsapp, giftCards };
  return cached;
}

/** Test-only: clears the module-level cache so tests can mutate env.ADAPTERS between cases. */
export function resetAdaptersCacheForTests(): void {
  cached = undefined;
}
