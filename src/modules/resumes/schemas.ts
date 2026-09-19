import { z } from "zod";

export const registerUploadInputSchema = z.object({
  seekerProfileId: z.string().uuid(),
  objectKey: z.string().min(1),
  originalFilename: z.string().min(1),
});
