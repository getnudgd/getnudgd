import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Card } from "./Card";

describe("Card", () => {
  it("renders children inside a ui-card container", () => {
    render(<Card>Content</Card>);
    expect(screen.getByText("Content")).toHaveClass("ui-card");
  });
});
