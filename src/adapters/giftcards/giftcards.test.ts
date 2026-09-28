import { describe, it, expect } from "vitest";
import { createManualFulfilmentVendor } from "./manual";
import { createFakeGiftCardVendor } from "./fake";
import type { IssueGiftCardInput } from "./types";

const input: IssueGiftCardInput = {
  redemptionId: "redemption-1",
  brand: "Amazon",
  denominationPaise: 50000,
};

describe("createManualFulfilmentVendor", () => {
  it("has name 'manual'", () => {
    const vendor = createManualFulfilmentVendor();
    expect(vendor.name).toBe("manual");
  });

  it("always returns pending with a null vendorRef", async () => {
    const vendor = createManualFulfilmentVendor();
    const result = await vendor.issue(input);
    expect(result).toEqual({ status: "pending", vendorRef: null });
  });
});

describe("createFakeGiftCardVendor", () => {
  it("has name 'fake'", () => {
    const { vendor } = createFakeGiftCardVendor();
    expect(vendor.name).toBe("fake");
  });

  it("records issued calls", async () => {
    const { vendor, issued } = createFakeGiftCardVendor();
    await vendor.issue(input);
    expect(issued).toEqual([input]);
  });

  it("defaults to pending/null when no result is set", async () => {
    const { vendor } = createFakeGiftCardVendor();
    const result = await vendor.issue(input);
    expect(result).toEqual({ status: "pending", vendorRef: null });
  });

  it("returns the configured result via setResult", async () => {
    const { vendor, setResult } = createFakeGiftCardVendor();
    setResult({ status: "issued", vendorRef: "V1" });
    const result = await vendor.issue(input);
    expect(result).toEqual({ status: "issued", vendorRef: "V1" });
  });

  it("rejects with a failure error when setFailure(true) is set", async () => {
    const { vendor, setFailure } = createFakeGiftCardVendor();
    setFailure(true);
    await expect(vendor.issue(input)).rejects.toThrow("fake gift-card vendor failure");
  });

  it("stops failing once setFailure(false) is set", async () => {
    const { vendor, setFailure } = createFakeGiftCardVendor();
    setFailure(true);
    setFailure(false);
    await expect(vendor.issue(input)).resolves.toEqual({ status: "pending", vendorRef: null });
  });
});
