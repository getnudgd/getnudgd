import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Countdown } from "./Countdown";

describe("Countdown", () => {
  it("renders hours and minutes remaining until the deadline", () => {
    const serverNow = new Date("2026-01-01T00:00:00Z");
    const deadline = new Date("2026-01-01T02:30:00Z");
    render(<Countdown deadline={deadline} serverNow={serverNow} />);
    expect(screen.getByText("2h 30m")).toBeInTheDocument();
  });

  it("renders Expired once the deadline has passed", () => {
    const serverNow = new Date("2026-01-02T00:00:00Z");
    const deadline = new Date("2026-01-01T00:00:00Z");
    render(<Countdown deadline={deadline} serverNow={serverNow} />);
    expect(screen.getByText("Expired")).toBeInTheDocument();
  });
});
