import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Sheet } from "./Sheet";

describe("Sheet", () => {
  it("renders nothing when closed", () => {
    render(
      <Sheet open={false} onClose={vi.fn()} title="Send request">
        Body
      </Sheet>
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders as a dialog with the title and children when open", () => {
    render(
      <Sheet open onClose={vi.fn()} title="Send request">
        Body content
      </Sheet>
    );
    expect(screen.getByRole("dialog", { name: "Send request" })).toBeInTheDocument();
    expect(screen.getByText("Body content")).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} title="Send request">
        Body
      </Sheet>
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} title="Send request">
        Body
      </Sheet>
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
