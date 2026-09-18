import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Timeline } from "./Timeline";

describe("Timeline", () => {
  it("renders one item per step and marks completed steps", () => {
    render(
      <Timeline
        steps={[
          { label: "Sent", complete: true, at: new Date("2026-01-01T00:00:00Z") },
          { label: "Accepted", complete: false },
        ]}
      />
    );
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveClass("complete");
    expect(items[1]).not.toHaveClass("complete");
  });
});
