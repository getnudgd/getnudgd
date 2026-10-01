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

import InsiderLayout from "./layout";

describe("InsiderLayout", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    getCurrentUserMock.mockReset();
  });

  it("redirects to /login when there is no session", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    await expect(InsiderLayout({ children: <p>Inbox content</p> })).rejects.toThrow("REDIRECT:/login");
  });

  it("redirects to /onboard?add=insider when signed in with no Insider profile at all", async () => {
    getCurrentUserMock.mockResolvedValue({ userId: "u1", role: "seeker", seekerProfileId: "sp1", insiderProfile: null });
    await expect(InsiderLayout({ children: <p>Inbox content</p> })).rejects.toThrow("REDIRECT:/onboard?add=insider");
  });

  it("redirects to bare /onboard (resuming the OTP step) when the Insider profile exists but is unverified", async () => {
    getCurrentUserMock.mockResolvedValue({
      userId: "u1",
      role: "insider",
      seekerProfileId: null,
      insiderProfile: { id: "ip1", verifiedAt: null },
    });
    await expect(InsiderLayout({ children: <p>Inbox content</p> })).rejects.toThrow("REDIRECT:/onboard");
    expect(redirectMock).toHaveBeenCalledWith("/onboard");
  });

  it("renders the shell for a verified Insider", async () => {
    getCurrentUserMock.mockResolvedValue({
      userId: "u1",
      role: "insider",
      seekerProfileId: null,
      insiderProfile: { id: "ip1", verifiedAt: new Date() },
    });
    const element = await InsiderLayout({ children: <p>Inbox content</p> });
    render(element);
    expect(screen.getByText("Inbox content")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
  });

  it("renders the shell for an admin even with no Insider profile", async () => {
    getCurrentUserMock.mockResolvedValue({ userId: "admin-1", role: "admin", seekerProfileId: null, insiderProfile: null });
    const element = await InsiderLayout({ children: <p>Inbox content</p> });
    render(element);
    expect(screen.getByText("Inbox content")).toBeInTheDocument();
  });
});
