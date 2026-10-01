import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getCurrentUserMock = vi.fn();
vi.mock("@/src/lib/current-user", () => ({
  getCurrentUser: () => getCurrentUserMock(),
}));

import AdminIndexPage from "./page";

describe("AdminIndexPage", () => {
  beforeEach(() => {
    getCurrentUserMock.mockReset();
  });

  it("renders a heading and the signed-in admin's id", async () => {
    getCurrentUserMock.mockResolvedValue({ userId: "admin-1", role: "admin", seekerProfileId: null, insiderProfile: null });
    const element = await AdminIndexPage();
    render(element);
    expect(screen.getByRole("heading", { name: "Admin" })).toBeInTheDocument();
    expect(screen.getByText(/admin-1/)).toBeInTheDocument();
  });
});
