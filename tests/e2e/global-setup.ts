import { Pool } from "pg";

const DOCKER_CLI_HINT =
  "Docker Desktop is not on PATH: C:\\Users\\dml-anmol\\AppData\\Local\\Programs\\DockerDesktop\\resources\\bin";

function setupFailure(reason: string): Error {
  return new Error(
    `[e2e] ${reason}\n\n` +
      "Fix, in order:\n" +
      `  1. Start Docker Desktop if it isn't running (${DOCKER_CLI_HINT})\n` +
      "  2. docker compose -f infra/compose.dev.yml up -d postgres\n" +
      "  3. npm run db:migrate\n" +
      "  4. npm run db:seed\n\n" +
      "Then run the suite with .env.local exported in a subshell (never before plain `npm test`):\n" +
      "  export $(grep -v '^#' .env.local | grep -v '^$' | xargs -d '\\n'); npm run test:e2e"
  );
}

// Counts notify.send jobs pg-boss still has outstanding (queued or retrying, and due).
// Real finding from 2026-09-30: pg-boss defaults to batchSize 1 with a 2000ms poll
// interval (see queue.real.ts's work(), which sets neither), so this queue clears
// roughly 0.5 jobs/s. A vitest live-test run that enqueues notify.send jobs without a
// consumer running (or a stale malformed row a template no longer accepts) leaves a
// backlog that silently eats into every later flow's notification-wait budget — the
// failure then reads as "notification never reached sent", which looks like a
// delivery bug, not environment debris. This check turns that into a named, fail-fast
// setup error instead.
export async function checkNotifySendBacklog(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    "select count(*) as count from pgboss.job " +
      "where name = 'notify.send' and state in ('created', 'retry') and start_after <= now()"
  );
  return Number(rows[0].count);
}

export default async function globalSetup(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw setupFailure("DATABASE_URL is not set.");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query("select 1");

    const companies = await pool.query<{ count: string }>("select count(*) as count from companies");
    if (Number(companies.rows[0].count) === 0) {
      throw setupFailure("No seeded companies found.");
    }

    const rules = await pool.query<{ value: { pointsPerCredit?: number } }>(
      "select value from app_config where key = 'rules' order by version desc limit 1"
    );
    if (rules.rows.length === 0 || rules.rows[0].value.pointsPerCredit === undefined) {
      throw setupFailure(
        "The latest seeded `rules` version has no `pointsPerCredit` — the rewards config placeholders " +
          "(rules version 2 or later) haven't been seeded."
      );
    }

    const backlog = await checkNotifySendBacklog(pool);
    if (backlog > 0) {
      const estimateSeconds = Math.ceil(backlog / 0.5);
      throw setupFailure(
        `${backlog} outstanding notify.send job(s) are already queued on this database (pgboss.job, ` +
          "state created/retry) — left over from an earlier vitest live-test run or a previous e2e run " +
          "that didn't finish draining. pg-boss's default throughput here is about 0.5 jobs/s (batchSize " +
          "1, 2000ms poll — see queue.real.ts), so this backlog alone could delay this run's own " +
          `notification deliveries by roughly ${estimateSeconds}s, on top of anything this run adds. Drain it ` +
          'first: start a worker against this DATABASE_URL (e.g. run one flow spec once, or `npm run ' +
          "worker:dev` briefly with no e2e test running concurrently) and wait for it to catch up, then re-run."
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("[e2e]")) throw err;
    throw setupFailure(`Could not reach Postgres: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await pool.end();
  }
}
