import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { createRealDatabase } from "../../src/adapters/db/real";
import { createRealQueueClient } from "../../src/jobs/queue.real";
import { startWorker, type WorkerDeps } from "../../src/jobs/worker";
import { createFakeEmailSender } from "../../src/adapters/email/fake";
import { createFakeWhatsAppGateway } from "../../src/adapters/whatsapp/fake";
import type { Database } from "../../src/adapters/db/types";
import type { QueueClient } from "../../src/jobs/queue";
import type { EmailMessage } from "../../src/adapters/email/types";
import type { WhatsAppGateway } from "../../src/adapters/whatsapp/types";

// NOTE: never run this suite while `npm run worker:dev` is pointed at the same
// DATABASE_URL — it is an independent, permanent consumer of the real "notify.send"
// queue and would race with this run's in-process worker exactly like two Playwright
// worker processes would (see playwright.config.ts's workers: 1 comment).

export interface E2eContext {
  db: Database;
  pool: Pool;
  queue: QueueClient;
  emailSent: EmailMessage[];
  whatsapp: WhatsAppGateway;
  companyId: string;
  teardown(): Promise<void>;
}

export async function createE2eContext(): Promise<E2eContext> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = createRealDatabase(drizzle(pool));
  const queue = createRealQueueClient(process.env.DATABASE_URL as string);
  const { sender, sent } = createFakeEmailSender();
  const whatsapp = createFakeWhatsAppGateway();

  // startWorker() calls deps.queue.start() itself — do not call queue.start() here too.
  const workerDeps: WorkerDeps = { db, queue, email: sender, whatsapp: whatsapp.gateway };
  await startWorker(workerDeps);

  const { rows } = await pool.query<{ id: string }>("select id from companies limit 1");
  if (rows.length === 0) throw new Error("No seeded companies found — run `npm run db:seed` first");
  const companyId = rows[0].id;

  return {
    db,
    pool,
    queue,
    emailSent: sent,
    whatsapp: whatsapp.gateway,
    companyId,
    async teardown() {
      await queue.stop();
      await pool.end();
    },
  };
}

export async function seedFundedSeeker(
  ctx: E2eContext,
  tag: string,
  counter: number
): Promise<{ profileId: string; userId: string; email: string }> {
  const email = `s-${tag}-${counter}@x.com`;
  const user = await ctx.db.identity.findOrCreateUser(`fb-e2e-${tag}-s${counter}`, email, "seeker");
  const profile = await ctx.db.identity.createSeekerProfile(user.id, `E2E Seeker ${counter}`);

  // Fund enough to cover the most expensive tier, read from config, never a literal.
  const rules = await ctx.pool.query<{ value: { requestCostByTier: Record<string, number> } }>(
    "select value from app_config where key = 'rules' order by version desc limit 1"
  );
  const maxCost = Math.max(...Object.values(rules.rows[0].value.requestCostByTier));

  await ctx.db.ledger.postTxn({
    idempotencyKey: `e2e:${tag}:grant:${counter}`,
    eventType: "credits.grant",
    entries: [
      { ownerType: "platform", ownerId: "platform", currency: "credits", amount: -maxCost },
      { ownerType: "seeker", ownerId: profile.id, currency: "credits", amount: maxCost },
    ],
  });

  return { profileId: profile.id, userId: user.id, email };
}

export async function seedVerifiedInsider(
  ctx: E2eContext,
  tag: string,
  counter: number
): Promise<{ profileId: string; userId: string; email: string }> {
  const email = `i-${tag}-${counter}@acme.com`;
  const user = await ctx.db.identity.findOrCreateUser(`fb-e2e-${tag}-i${counter}`, email, "seeker");
  const profile = await ctx.db.identity.findOrCreateInsiderProfile(user.id, ctx.companyId, email);
  await ctx.db.identity.markInsiderVerified(profile.id, new Date());
  return { profileId: profile.id, userId: user.id, email };
}

export async function seedAdminUser(ctx: E2eContext, tag: string): Promise<string> {
  const user = await ctx.db.identity.findOrCreateUser(`fb-e2e-${tag}-admin`, `admin-${tag}@x.com`, "admin");
  return user.id;
}

export function notificationKey(eventKey: string, template: string, userId: string): string {
  return `${eventKey}:${template}:${userId}`;
}

export async function findNotification(
  pool: Pool,
  idempotencyKey: string
): Promise<{ id: string; status: string; channel: string | null } | null> {
  const { rows } = await pool.query<{ id: string; status: string; channel: string | null }>(
    "select id, status, channel from notifications where idempotency_key = $1",
    [idempotencyKey]
  );
  return rows[0] ?? null;
}

export async function waitUntil(
  check: () => Promise<boolean>,
  timeoutMs: number,
  label: string
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for: ${label}`);
}
