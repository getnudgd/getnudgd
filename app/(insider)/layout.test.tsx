import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import InsiderLayout from "./layout";

describe("InsiderLayout", () => {
  it("wraps children in the insider scope with the bottom nav", () => {
    render(
      <InsiderLayout>
        <p>Inbox content</p>
      </InsiderLayout>
    );
    expect(screen.getByText("Inbox content")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Rewards" })).toHaveAttribute("href", "/rewards");
  });
});
