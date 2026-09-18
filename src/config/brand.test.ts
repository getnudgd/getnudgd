import { describe, it, expect } from "vitest";
import { brand } from "./brand";

describe("brand", () => {
  it("uses the GetNudgd brand, never the outdated Referly name", () => {
    expect(brand.name).toBe("GetNudgd");
    expect(brand.domain).toBe("getnudgd.com");
  });

  it("uses the locked CTA copy", () => {
    expect(brand.ctaGetVouched).toBe("Get vouched in");
  });
});
