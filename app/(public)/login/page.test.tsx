import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

const notFoundMock = vi.fn(() => {
  throw new Error("NOT_FOUND");
});
vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
}));

import { resetEnvCacheForTests } from "@/src/config/env";
import LoginPage from "./page";

const REQUIRED_ENV = {
  APP_URL: "http://localhost:3000",
  BRAND_NAME: "GetNudgd",
  BRAND_DOMAIN: "getnudgd.com",
  DATABASE_URL: "postgres://getnudgd:getnudgd@localhost:5432/getnudgd",
  SESSION_COOKIE_SECRET: "a-test-secret-that-is-at-least-32-characters-long",
};

describe("LoginPage", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetEnvCacheForTests();
    process.env = { ...originalEnv, NODE_ENV: "development", ...REQUIRED_ENV };
    notFoundMock.mockClear();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetEnvCacheForTests();
  });

  it("renders the login form when DEV_LOGIN_ENABLED is true", () => {
    process.env.DEV_LOGIN_ENABLED = "true";
    resetEnvCacheForTests();
    render(<LoginPage />);
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("calls notFound() when DEV_LOGIN_ENABLED is false", () => {
    process.env.DEV_LOGIN_ENABLED = "false";
    resetEnvCacheForTests();
    // Calling the (plain, synchronous) component function directly rather than through
    // render() — more robust than relying on React 19's act() rethrowing a render error.
    expect(() => LoginPage()).toThrow("NOT_FOUND");
  });

  it("calls notFound() in production regardless of DEV_LOGIN_ENABLED (defense in depth on top of Plan A's getEnv() refusal, which already makes this combination unreachable in a real deployment)", () => {
    process.env = { ...process.env, NODE_ENV: "production" };
    process.env.DEV_LOGIN_ENABLED = "false";
    resetEnvCacheForTests();
    expect(() => LoginPage()).toThrow("NOT_FOUND");
  });
});
