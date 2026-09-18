import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Chip } from "./Chip";

describe("Chip", () => {
  it("renders unselected by default and toggles on click", () => {
    const onClick = vi.fn();
    render(<Chip onClick={onClick}>Remote</Chip>);
    const chip = screen.getByRole("button", { name: "Remote" });
    expect(chip).not.toHaveClass("selected");
    fireEvent.click(chip);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("shows the selected class when selected", () => {
    render(<Chip selected>Remote</Chip>);
    expect(screen.getByRole("button", { name: "Remote" })).toHaveClass("selected");
  });
});
