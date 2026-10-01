import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getCurrentUserMock = vi.fn();
vi.mock("@/src/lib/current-user", () => ({
  getCurrentUser: () => getCurrentUserMock(),
}));

import InsiderDashboardPage from "./page";

describe("InsiderDashboardPage", () => {
  beforeEach(() => {
    getCurrentUserMock.mockReset();
  });

  it("renders a heading and the signed-in user's id", async () => {
    getCurrentUserMock.mockResolvedValue({
      userId: "u1",
      role: "insider",
      seekerProfileId: null,
      insiderProfile: { id: "ip1", verifiedAt: new Date() },
    });
    const element = await InsiderDashboardPage();
    render(element);
    expect(screen.getByRole("heading", { name: "Insider dashboard" })).toBeInTheDocument();
    expect(screen.getByText(/u1/)).toBeInTheDocument();
  });
});
