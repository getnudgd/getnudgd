export interface IssueGiftCardInput {
  redemptionId: string;
  brand: string;
  denominationPaise: number;
}

export interface IssueGiftCardResult {
  status: "pending" | "issued";
  vendorRef: string | null;
}

export interface GiftCardVendor {
  readonly name: string;
  issue(input: IssueGiftCardInput): Promise<IssueGiftCardResult>;
}
