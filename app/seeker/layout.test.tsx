import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});
vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
}));

const getCurrentUserMock = vi.fn();
vi.mock("@/src/lib/current-user", () => ({
  getCurrentUser: () => getCurrentUserMock(),
}));

import SeekerLayout from "./layout";

describe("SeekerLayout", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    getCurrentUserMock.mockReset();
  });

  it("redirects to /login when there is no session", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    await expect(SeekerLayout({ children: <p>Dashboard content</p> })).rejects.toThrow("REDIRECT:/login");
  });

  it("redirects to /onboard?add=seeker when signed in with no Seeker profile", async () => {
    getCurrentUserMock.mockResolvedValue({ userId: "u1", role: "insider", seekerProfileId: null, insiderProfile: { id: "ip1", verifiedAt: new Date() } });
    await expect(SeekerLayout({ children: <p>Dashboard content</p> })).rejects.toThrow("REDIRECT:/onboard?add=seeker");
  });

  it("renders the shell with the bottom nav for a user with a Seeker profile", async () => {
    getCurrentUserMock.mockResolvedValue({ userId: "u1", role: "seeker", seekerProfileId: "sp1", insiderProfile: null });
    const element = await SeekerLayout({ children: <p>Dashboard content</p> });
    render(element);
    expect(screen.getByText("Dashboard content")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Insiders" })).toHaveAttribute("href", "/seeker/insiders");
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
  });

  it("renders the shell for an admin even with no Seeker profile", async () => {
    getCurrentUserMock.mockResolvedValue({ userId: "admin-1", role: "admin", seekerProfileId: null, insiderProfile: null });
    const element = await SeekerLayout({ children: <p>Dashboard content</p> });
    render(element);
    expect(screen.getByText("Dashboard content")).toBeInTheDocument();
  });
});
