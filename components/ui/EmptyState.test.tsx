import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders a title, description, and optional action", () => {
    render(<EmptyState title="No requests yet" description="Send your first Insider Request." action={<button>Browse Insiders</button>} />);
    expect(screen.getByText("No requests yet")).toBeInTheDocument();
    expect(screen.getByText("Send your first Insider Request.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Browse Insiders" })).toBeInTheDocument();
  });
});
