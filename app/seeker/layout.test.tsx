import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import SeekerLayout from "./layout";

describe("SeekerLayout", () => {
  it("wraps children in the seeker scope with the bottom nav", () => {
    render(
      <SeekerLayout>
        <p>Dashboard content</p>
      </SeekerLayout>
    );
    expect(screen.getByText("Dashboard content")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Insiders" })).toHaveAttribute("href", "/seeker/insiders");
  });
});
