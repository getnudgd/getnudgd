import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getCurrentUserMock = vi.fn();
vi.mock("@/src/lib/current-user", () => ({
  getCurrentUser: () => getCurrentUserMock(),
}));

import SeekerDashboardPage from "./page";

describe("SeekerDashboardPage", () => {
  beforeEach(() => {
    getCurrentUserMock.mockReset();
  });

  it("renders a heading and the signed-in user's id", async () => {
    getCurrentUserMock.mockResolvedValue({ userId: "u1", role: "seeker", seekerProfileId: "sp1", insiderProfile: null });
    const element = await SeekerDashboardPage();
    render(element);
    expect(screen.getByRole("heading", { name: "Seeker dashboard" })).toBeInTheDocument();
    expect(screen.getByText(/u1/)).toBeInTheDocument();
  });
});
