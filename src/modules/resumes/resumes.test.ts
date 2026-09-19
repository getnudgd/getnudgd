import { describe, it, expect } from "vitest";
import { createFakeDatabase } from "../../adapters/db/fake";
import { registerUpload, type ResumesDeps } from "./resumes";

function makeDeps(): ResumesDeps {
  const { db } = createFakeDatabase();
  return { db };
}

describe("registerUpload", () => {
  it("registers an upload and returns its id and status", async () => {
    const deps = makeDeps();
    const result = await registerUpload(deps, "seeker-1", "resumes/seeker-1/resume.pdf", "resume.pdf");
    expect(result.resumeId).toBeTruthy();
    expect(result.status).toBe("uploaded");
  });

  it("rejects an empty objectKey", async () => {
    const deps = makeDeps();
    await expect(registerUpload(deps, "seeker-1", "", "resume.pdf")).rejects.toThrow();
  });

  it("rejects an empty originalFilename", async () => {
    const deps = makeDeps();
    await expect(registerUpload(deps, "seeker-1", "resumes/seeker-1/resume.pdf", "")).rejects.toThrow();
  });
});
