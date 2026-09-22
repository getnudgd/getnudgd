import { getAdapters } from "../lib/adapters";
import { startWorker } from "./worker";

const { db, queue } = getAdapters();

startWorker({ db, queue }).catch((err) => {
  console.error("[worker] failed to start", err);
  process.exit(1);
});
