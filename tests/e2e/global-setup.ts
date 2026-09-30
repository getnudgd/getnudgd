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
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("[e2e]")) throw err;
    throw setupFailure(`Could not reach Postgres: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await pool.end();
  }
}
