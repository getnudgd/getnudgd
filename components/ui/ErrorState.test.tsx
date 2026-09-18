import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorState } from "./ErrorState";

describe("ErrorState", () => {
  it("renders the title as an alert", () => {
    render(<ErrorState title="Couldn't load requests" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load requests");
  });

  it("calls onRetry when the retry button is clicked", () => {
    const onRetry = vi.fn();
    render(<ErrorState title="Couldn't load requests" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("omits the retry button when onRetry is not provided", () => {
    render(<ErrorState title="Couldn't load requests" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
