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

export const createOrGetSeekerProfileInputSchema = z.object({
  fullName: z.string().min(1),
});

export const requestWorkEmailOtpInputSchema = z.object({
  fullName: z.string().min(1),
  workEmail: z.string().email(),
});

export const verifyWorkEmailOtpForUserInputSchema = z.object({
  code: z.string().length(6),
});

export const devLoginInputSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
});
