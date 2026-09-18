import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "./Badge";

describe("Badge", () => {
  it("renders its children with a neutral tone by default", () => {
    render(<Badge>Pending</Badge>);
    expect(screen.getByText("Pending")).toHaveClass("ui-badge-neutral");
  });

  it("applies the requested tone class", () => {
    render(<Badge tone="success">Verified</Badge>);
    expect(screen.getByText("Verified")).toHaveClass("ui-badge-success");
  });
});
