import { getEnv } from "../config/env";
import { getAdapters } from "../lib/adapters.impl";
import { startWorker } from "./worker";

// Fail fast rather than silently expiring nothing: if this is a production
// deploy and ADAPTERS isn't "real" (e.g. missing from the deployed .env), the
// worker would otherwise boot cleanly on in-memory fake adapters and never
// touch the real database or queue.
const env = getEnv();
if (process.env.NODE_ENV === "production" && env.ADAPTERS !== "real") {
  console.error(
    `[worker] refusing to start: NODE_ENV=production but ADAPTERS=${env.ADAPTERS} (expected "real")`
  );
  process.exit(1);
}

const { db, queue } = getAdapters();

startWorker({ db, queue }).catch((err) => {
  console.error("[worker] failed to start", err);
  process.exit(1);
});
