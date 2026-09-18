import { describe, it, expect } from "vitest";
import { getHealthReport } from "./health";
import { createFakeDatabase } from "../adapters/db/fake";
import { createFakeStorageAdapter } from "../adapters/storage/fake";
import { createFakeQueueClient } from "../jobs/queue.fake";

describe("getHealthReport", () => {
  it("reports ok when all checks pass", async () => {
    const { db } = createFakeDatabase();
    const storage = createFakeStorageAdapter();
    const queue = createFakeQueueClient();
    await queue.start();

    const report = await getHealthReport({ db, storage, queue });

    expect(report.ok).toBe(true);
    expect(report.checks.map((c) => c.name)).toEqual(["db", "storage", "queue"]);
  });

  it("reports not ok when a check fails, without leaking other checks' failures", async () => {
    const { db } = createFakeDatabase();
    const queue = createFakeQueueClient();
    await queue.start();
    const failingStorage = {
      async createSignedUploadUrl(): Promise<never> {
        throw new Error("bucket unreachable");
      },
      async createSignedDownloadUrl(): Promise<never> {
        throw new Error("bucket unreachable");
      },
    };

    const report = await getHealthReport({ db, storage: failingStorage, queue });

    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.name === "storage")?.ok).toBe(false);
    expect(report.checks.find((c) => c.name === "db")?.ok).toBe(true);
  });
});
