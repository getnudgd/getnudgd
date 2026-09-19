// The real "server-only" package throws when resolved outside Next.js's bundler,
// which includes plain Vitest runs. Next.js's own build swaps it for a no-op in
// server bundles; this file reproduces that no-op for tests.
export {};
