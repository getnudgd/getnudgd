import { describe, it, expect } from "vitest";
import { createFakeStorageAdapter } from "./fake";

describe("createFakeStorageAdapter", () => {
  it("returns a signed upload url scoped to the bucket and object key", async () => {
    const storage = createFakeStorageAdapter();
    const result = await storage.createSignedUploadUrl("gn-resumes", "user-1/resume.pdf");
    expect(result.url).toContain("gn-resumes");
    expect(result.url).toContain("user-1/resume.pdf");
    expect(result.objectKey).toBe("user-1/resume.pdf");
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("returns a signed download url", async () => {
    const storage = createFakeStorageAdapter();
    const result = await storage.createSignedDownloadUrl("gn-proofs", "req-1/proof.png");
    expect(result.url).toContain("gn-proofs");
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});
