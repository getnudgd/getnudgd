import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Skeleton } from "./Skeleton";

describe("Skeleton", () => {
  it("renders a hidden placeholder block with the requested size", () => {
    const { container } = render(<Skeleton width="80px" height="20px" />);
    const el = container.querySelector(".ui-skeleton");
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el).toHaveStyle({ width: "80px", height: "20px" });
  });
});
