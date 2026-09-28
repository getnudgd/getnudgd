import type { GiftCardVendor } from "./types";

/**
 * Manual fulfilment: the founder fulfils gift card redemptions by hand from
 * `/admin`. `issue` never talks to a real vendor API; it always reports the
 * redemption as pending so the admin queue can pick it up.
 */
export function createManualFulfilmentVendor(): GiftCardVendor {
  return {
    name: "manual",
    async issue() {
      return { status: "pending", vendorRef: null };
    },
  };
}
