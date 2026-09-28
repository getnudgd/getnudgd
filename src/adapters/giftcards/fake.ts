import type { GiftCardVendor, IssueGiftCardInput, IssueGiftCardResult } from "./types";

export interface FakeGiftCardVendor {
  vendor: GiftCardVendor;
  issued: IssueGiftCardInput[];
  setResult(result: IssueGiftCardResult): void;
  setFailure(fail: boolean): void;
}

export function createFakeGiftCardVendor(): FakeGiftCardVendor {
  const issued: IssueGiftCardInput[] = [];
  let result: IssueGiftCardResult = { status: "pending", vendorRef: null };
  let shouldFail = false;

  const vendor: GiftCardVendor = {
    name: "fake",
    async issue(input) {
      if (shouldFail) throw new Error("fake gift-card vendor failure");
      issued.push(input);
      return result;
    },
  };

  return {
    vendor,
    issued,
    setResult(newResult) {
      result = newResult;
    },
    setFailure(fail) {
      shouldFail = fail;
    },
  };
}
