import { describe, it, expect, vi, beforeEach } from "vitest";

const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});
vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
}));

const cookieStore = new Map<string, string>([["gn_session", "some-token"]]);
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieStore.has(name) ? { value: cookieStore.get(name)! } : undefined),
    set: (name: string, value: string) => {
      cookieStore.set(name, value);
    },
    delete: (name: string) => {
      cookieStore.delete(name);
    },
  }),
}));

import { logoutAction } from "./actions";

describe("logoutAction", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    cookieStore.set("gn_session", "some-token");
  });

  it("clears the session cookie and redirects to /", async () => {
    await expect(logoutAction()).rejects.toThrow("REDIRECT:/");
    expect(cookieStore.has("gn_session")).toBe(false);
  });
});
