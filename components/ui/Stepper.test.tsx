import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Stepper } from "./Stepper";

describe("Stepper", () => {
  it("calls onChange with an incremented value", () => {
    const onChange = vi.fn();
    render(<Stepper value={2} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Increase" }));
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it("calls onChange with a decremented value", () => {
    const onChange = vi.fn();
    render(<Stepper value={2} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Decrease" }));
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it("disables decrease at min and increase at max", () => {
    const onChange = vi.fn();
    render(<Stepper value={5} min={0} max={5} onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Increase" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Decrease" })).not.toBeDisabled();
  });
});
