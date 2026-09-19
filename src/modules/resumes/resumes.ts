import type { Database } from "../../adapters/db/types";

export interface ResumesDeps {
  db: Database;
}

export interface RegisterUploadResult {
  resumeId: string;
  status: string;
}

export async function registerUpload(
  deps: ResumesDeps,
  seekerProfileId: string,
  objectKey: string,
  originalFilename: string
): Promise<RegisterUploadResult> {
  if (!objectKey) throw new Error("objectKey is required");
  if (!originalFilename) throw new Error("originalFilename is required");
  const resume = await deps.db.resumes.registerUpload(seekerProfileId, objectKey, originalFilename);
  return { resumeId: resume.id, status: resume.status };
}
