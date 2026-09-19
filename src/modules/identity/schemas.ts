import { z } from "zod";

export const roleSchema = z.enum(["seeker", "insider", "admin", "both"]);
export type RoleInput = z.infer<typeof roleSchema>;

export const signInWithFirebaseTokenInputSchema = z.object({
  idToken: z.string().min(1),
});

export const startWorkEmailOtpInputSchema = z.object({
  userId: z.string().uuid(),
  workEmail: z.string().email(),
});

export const verifyWorkEmailOtpInputSchema = z.object({
  insiderProfileId: z.string().uuid(),
  code: z.string().length(6),
});
