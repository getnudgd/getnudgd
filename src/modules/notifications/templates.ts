import { z } from "zod";
import { brand } from "../../config/brand";

/**
 * Escapes HTML special characters to prevent injection attacks.
 * Must escape & first to avoid double-escaping.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const requestAcceptedPayloadSchema = z.object({
  requestId: z.string().min(1),
  companyName: z.string().min(1),
});
export type RequestAcceptedPayload = z.infer<typeof requestAcceptedPayloadSchema>;

export const requestDeclinedPayloadSchema = z.object({
  requestId: z.string().min(1),
  companyName: z.string().min(1),
  refundedCredits: z.number().int().nonnegative(),
});
export type RequestDeclinedPayload = z.infer<typeof requestDeclinedPayloadSchema>;

export const requestExpiredPayloadSchema = requestDeclinedPayloadSchema;
export type RequestExpiredPayload = RequestDeclinedPayload;

export const proofVerifiedPayloadSchema = z.object({
  requestId: z.string().min(1),
  companyName: z.string().min(1),
  audience: z.enum(["insider", "seeker"]),
  seekerName: z.string().min(1).optional(),
});
export type ProofVerifiedPayload = z.infer<typeof proofVerifiedPayloadSchema>;

export const proofRejectedPayloadSchema = z.object({
  requestId: z.string().min(1),
  seekerName: z.string().min(1),
  reason: z.string().min(1),
});
export type ProofRejectedPayload = z.infer<typeof proofRejectedPayloadSchema>;

export const rewardReleasedPayloadSchema = z.object({
  requestId: z.string().min(1),
  tranche: z.union([z.literal(1), z.literal(2)]),
  points: z.number().int().positive(),
  companyName: z.string().min(1),
});
export type RewardReleasedPayload = z.infer<typeof rewardReleasedPayloadSchema>;

export const redemptionFulfilledPayloadSchema = z.object({
  redemptionId: z.string().min(1),
  brand: z.string().min(1),
  points: z.number().int().positive(),
});
export type RedemptionFulfilledPayload = z.infer<typeof redemptionFulfilledPayloadSchema>;

export const redemptionRejectedPayloadSchema = z.object({
  redemptionId: z.string().min(1),
  points: z.number().int().positive(),
  reason: z.string().min(1),
});
export type RedemptionRejectedPayload = z.infer<typeof redemptionRejectedPayloadSchema>;

export interface EmailContent {
  subject: string;
  html: string;
}

export interface TemplateDefinition {
  payloadSchema: z.ZodType;
  renderEmail(payload: unknown): EmailContent;
  renderWhatsAppText(payload: unknown): string;
  whatsappTemplateName: string;
  whatsappParams(payload: unknown): Record<string, string>;
}

export const templateNames = [
  "request.accepted",
  "request.declined",
  "request.expired",
  "proof.verified",
  "proof.rejected",
  "reward.released",
  "redemption.fulfilled",
  "redemption.rejected",
] as const;
export type TemplateName = (typeof templateNames)[number];

export const templates: Record<TemplateName, TemplateDefinition> = {
  "request.accepted": {
    payloadSchema: requestAcceptedPayloadSchema,
    renderEmail(raw) {
      const payload = requestAcceptedPayloadSchema.parse(raw);
      return {
        subject: "Your Insider Request was accepted",
        html: `<p>Good news — an Insider at ${escapeHtml(payload.companyName)} accepted your Insider Request on ${brand.name}. They'll submit you internally soon.</p>`,
      };
    },
    renderWhatsAppText(raw) {
      const payload = requestAcceptedPayloadSchema.parse(raw);
      return `Good news! An Insider at ${payload.companyName} accepted your Insider Request on ${brand.name}.`;
    },
    whatsappTemplateName: "request_accepted",
    whatsappParams(raw) {
      const payload = requestAcceptedPayloadSchema.parse(raw);
      return { companyName: payload.companyName };
    },
  },
  "request.declined": {
    payloadSchema: requestDeclinedPayloadSchema,
    renderEmail(raw) {
      const payload = requestDeclinedPayloadSchema.parse(raw);
      return {
        subject: "Your Insider Request was declined",
        html: `<p>An Insider at ${escapeHtml(payload.companyName)} declined your Insider Request on ${brand.name}. ${payload.refundedCredits} credits have been refunded to your account.</p>`,
      };
    },
    renderWhatsAppText(raw) {
      const payload = requestDeclinedPayloadSchema.parse(raw);
      return `An Insider at ${payload.companyName} declined your Insider Request. ${payload.refundedCredits} credits refunded.`;
    },
    whatsappTemplateName: "request_declined",
    whatsappParams(raw) {
      const payload = requestDeclinedPayloadSchema.parse(raw);
      return { companyName: payload.companyName, refundedCredits: String(payload.refundedCredits) };
    },
  },
  "request.expired": {
    payloadSchema: requestExpiredPayloadSchema,
    renderEmail(raw) {
      const payload = requestExpiredPayloadSchema.parse(raw);
      return {
        subject: "Your Insider Request expired",
        html: `<p>Your Insider Request to ${escapeHtml(payload.companyName)} on ${brand.name} expired without a response. ${payload.refundedCredits} credits have been refunded to your account.</p>`,
      };
    },
    renderWhatsAppText(raw) {
      const payload = requestExpiredPayloadSchema.parse(raw);
      return `Your Insider Request to ${payload.companyName} expired. ${payload.refundedCredits} credits refunded.`;
    },
    whatsappTemplateName: "request_expired",
    whatsappParams(raw) {
      const payload = requestExpiredPayloadSchema.parse(raw);
      return { companyName: payload.companyName, refundedCredits: String(payload.refundedCredits) };
    },
  },
  "proof.verified": {
    payloadSchema: proofVerifiedPayloadSchema,
    renderEmail(raw) {
      const payload = proofVerifiedPayloadSchema.parse(raw);
      if (payload.audience === "insider") {
        return {
          subject: `You vouched for ${payload.seekerName ?? "a Seeker"} — verified!`,
          html: `<p>Your vouch for ${escapeHtml(payload.seekerName ?? "the Seeker")} at ${escapeHtml(payload.companyName)} has been verified on ${brand.name}. Your Insider Rewards will follow once processed.</p>`,
        };
      }
      return {
        subject: "You were submitted internally!",
        html: `<p>Great news — the Insider at ${escapeHtml(payload.companyName)} has confirmed you were submitted internally on ${brand.name}.</p>`,
      };
    },
    renderWhatsAppText(raw) {
      const payload = proofVerifiedPayloadSchema.parse(raw);
      if (payload.audience === "insider") {
        return `Your vouch for ${payload.seekerName ?? "the Seeker"} at ${payload.companyName} has been verified. Rewards to follow.`;
      }
      return `Great news — the Insider at ${payload.companyName} confirmed you were submitted internally!`;
    },
    whatsappTemplateName: "proof_verified",
    whatsappParams(raw) {
      const payload = proofVerifiedPayloadSchema.parse(raw);
      return {
        companyName: payload.companyName,
        audience: payload.audience,
        seekerName: payload.seekerName ?? "",
      };
    },
  },
  "proof.rejected": {
    payloadSchema: proofRejectedPayloadSchema,
    renderEmail(raw) {
      const payload = proofRejectedPayloadSchema.parse(raw);
      return {
        subject: `Your proof for ${payload.seekerName} needs another look`,
        html: `<p>Your submitted proof for ${escapeHtml(payload.seekerName)} on ${brand.name} was not accepted: ${escapeHtml(payload.reason)}. Please resubmit.</p>`,
      };
    },
    renderWhatsAppText(raw) {
      const payload = proofRejectedPayloadSchema.parse(raw);
      return `Your proof for ${payload.seekerName} wasn't accepted: ${payload.reason}. Please resubmit.`;
    },
    whatsappTemplateName: "proof_rejected",
    whatsappParams(raw) {
      const payload = proofRejectedPayloadSchema.parse(raw);
      return { seekerName: payload.seekerName, reason: payload.reason };
    },
  },
  "reward.released": {
    payloadSchema: rewardReleasedPayloadSchema,
    renderEmail(raw) {
      const payload = rewardReleasedPayloadSchema.parse(raw);
      return {
        subject: "You earned Insider Rewards points",
        html: `<p>Your vouch for a candidate at ${escapeHtml(payload.companyName)} earned you ${payload.points} points in Insider Rewards on ${brand.name} (tranche ${payload.tranche}).</p>`,
      };
    },
    renderWhatsAppText(raw) {
      const payload = rewardReleasedPayloadSchema.parse(raw);
      return `You earned ${payload.points} points in Insider Rewards for your vouch at ${payload.companyName} on ${brand.name}.`;
    },
    whatsappTemplateName: "reward_released",
    whatsappParams(raw) {
      const payload = rewardReleasedPayloadSchema.parse(raw);
      return { points: String(payload.points), companyName: payload.companyName };
    },
  },
  "redemption.fulfilled": {
    payloadSchema: redemptionFulfilledPayloadSchema,
    renderEmail(raw) {
      const payload = redemptionFulfilledPayloadSchema.parse(raw);
      const giftCardBrand = payload.brand;
      return {
        subject: "Your gift card redemption is fulfilled",
        html: `<p>Your redemption of ${payload.points} points for a ${escapeHtml(giftCardBrand)} gift card on ${brand.name} has been fulfilled.</p>`,
      };
    },
    renderWhatsAppText(raw) {
      const payload = redemptionFulfilledPayloadSchema.parse(raw);
      const giftCardBrand = payload.brand;
      return `Your redemption of ${payload.points} points for a ${giftCardBrand} gift card was fulfilled.`;
    },
    whatsappTemplateName: "redemption_fulfilled",
    whatsappParams(raw) {
      const payload = redemptionFulfilledPayloadSchema.parse(raw);
      return { points: String(payload.points), brand: payload.brand };
    },
  },
  "redemption.rejected": {
    payloadSchema: redemptionRejectedPayloadSchema,
    renderEmail(raw) {
      const payload = redemptionRejectedPayloadSchema.parse(raw);
      return {
        subject: "Your gift card redemption was not approved",
        html: `<p>Your redemption of ${payload.points} points on ${brand.name} was not approved: ${escapeHtml(payload.reason)}. The points are back in your wallet.</p>`,
      };
    },
    renderWhatsAppText(raw) {
      const payload = redemptionRejectedPayloadSchema.parse(raw);
      return `Your redemption of ${payload.points} points was not approved: ${payload.reason}. The points are back in your wallet.`;
    },
    whatsappTemplateName: "redemption_rejected",
    whatsappParams(raw) {
      const payload = redemptionRejectedPayloadSchema.parse(raw);
      return { points: String(payload.points), reason: payload.reason };
    },
  },
};
