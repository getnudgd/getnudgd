import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});
const notFoundMock = vi.fn(() => {
  throw new Error("NOT_FOUND");
});
vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
  notFound: () => notFoundMock(),
}));

const getCurrentUserMock = vi.fn();
vi.mock("@/src/lib/current-user", () => ({
  getCurrentUser: () => getCurrentUserMock(),
}));

import AdminLayout from "./layout";

describe("AdminLayout", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    notFoundMock.mockClear();
    getCurrentUserMock.mockReset();
  });

  it("redirects to /login when there is no session", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    await expect(AdminLayout({ children: <p>Requests queue</p> })).rejects.toThrow("REDIRECT:/login");
  });

  it("calls notFound() for a signed-in non-admin, never revealing the route exists via a redirect", async () => {
    getCurrentUserMock.mockResolvedValue({ userId: "u1", role: "seeker", seekerProfileId: "sp1", insiderProfile: null });
    await expect(AdminLayout({ children: <p>Requests queue</p> })).rejects.toThrow("NOT_FOUND");
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("renders the shell for an admin", async () => {
    getCurrentUserMock.mockResolvedValue({ userId: "admin-1", role: "admin", seekerProfileId: null, insiderProfile: null });
    const element = await AdminLayout({ children: <p>Requests queue</p> });
    render(element);
    expect(screen.getByText("Requests queue")).toBeInTheDocument();
  });
});
