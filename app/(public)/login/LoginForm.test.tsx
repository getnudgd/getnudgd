import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LoginForm } from "./LoginForm";
import { devLoginAction } from "./actions";

vi.mock("./actions", () => ({
  devLoginAction: vi.fn(),
}));

describe("LoginForm", () => {
  beforeEach(() => {
    vi.mocked(devLoginAction).mockReset();
  });

  it("starts on the email step and moves to the code step on Continue", () => {
    render(<LoginForm />);
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByLabelText("Code")).toBeInTheDocument();
  });

  it("blocks Continue on an invalid email without calling the server", () => {
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "not-an-email" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.queryByLabelText("Code")).not.toBeInTheDocument();
    expect(devLoginAction).not.toHaveBeenCalled();
  });

  it("submits email and code to devLoginAction and shows the problem title on failure", async () => {
    vi.mocked(devLoginAction).mockResolvedValue({
      ok: false,
      problem: { type: "dev-login-wrong-code", title: "That code is wrong." },
    });
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "111111" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(screen.getByText("That code is wrong.")).toBeInTheDocument());
    expect(devLoginAction).toHaveBeenCalledWith({ email: "a@b.com", code: "111111" });
  });

  it("lets the user go back to the email step", () => {
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Use a different email" }));
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });
});
