import { z } from "zod";

export const rulesSchema = z.object({
  responseWindowHours: z.number().int().positive(),
  interviewWindowDays: z.number().int().positive(),
  reverificationDays: z.number().int().positive(),
  tranche1Percent: z.number().min(0).max(100),
  tranche2Percent: z.number().min(0).max(100),
  refundPercentOnDecline: z.number().min(0).max(100),
  refundPercentOnExpiry: z.number().min(0).max(100),
  minRedemptionPoints: z.number().int().nonnegative(),
  panThresholdPoints: z.number().int().nonnegative(),
  freeCreditGrant: z.number().int().nonnegative(),
  requestCostByTier: z.record(z.string(), z.number().int().positive()),
});
export type Rules = z.infer<typeof rulesSchema>;

export const creditPackSchema = z.object({
  id: z.string(),
  credits: z.number().int().positive(),
  priceInPaise: z.number().int().positive(),
});
export type CreditPack = z.infer<typeof creditPackSchema>;

export const packsSchema = z.array(creditPackSchema);
