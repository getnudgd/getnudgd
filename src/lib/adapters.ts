import "server-only";

// The actual adapter-selection logic lives in ./adapters.impl, which has no
// "server-only" import so it can also be imported by the pg-boss worker entry
// point (src/jobs/run-worker.ts), which runs under plain Node/tsx rather than
// inside Next's react-server build condition. This file re-exports it and
// keeps the "server-only" guard for app/Next.js code that imports adapters
// from here, so it still can't accidentally end up in a client bundle.
export { getAdapters, resetAdaptersCacheForTests, type Adapters } from "./adapters.impl";
