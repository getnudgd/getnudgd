import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Select } from "./Select";

describe("Select", () => {
  it("renders an option per entry in options", () => {
    render(<Select options={[{ value: "a", label: "Option A" }, { value: "b", label: "Option B" }]} aria-label="Choose" />);
    const select = screen.getByLabelText("Choose");
    expect(select).toHaveClass("ui-input");
    expect(screen.getByRole("option", { name: "Option A" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Option B" })).toBeInTheDocument();
  });
});
