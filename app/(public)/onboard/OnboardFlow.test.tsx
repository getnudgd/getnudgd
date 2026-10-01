import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OnboardFlow } from "./OnboardFlow";
import {
  createSeekerProfileAction,
  requestInsiderOtpAction,
  resendInsiderOtpAction,
  verifyInsiderOtpAction,
} from "./actions";

vi.mock("./actions", () => ({
  createSeekerProfileAction: vi.fn(),
  requestInsiderOtpAction: vi.fn(),
  resendInsiderOtpAction: vi.fn(),
  verifyInsiderOtpAction: vi.fn(),
}));

describe("OnboardFlow", () => {
  beforeEach(() => {
    vi.mocked(createSeekerProfileAction).mockReset();
    vi.mocked(requestInsiderOtpAction).mockReset();
    vi.mocked(resendInsiderOtpAction).mockReset();
    vi.mocked(verifyInsiderOtpAction).mockReset();
  });

  it("role-choice: choosing Seeker moves to the Seeker name step", () => {
    render(<OnboardFlow startingStep="role-choice" />);
    fireEvent.click(screen.getByRole("button", { name: "I'm looking for a job" }));
    expect(screen.getByLabelText("Full name")).toBeInTheDocument();
  });

  it("role-choice: choosing Insider moves to the Insider name+email step", () => {
    render(<OnboardFlow startingStep="role-choice" />);
    fireEvent.click(screen.getByRole("button", { name: "I'm an Insider" }));
    expect(screen.getByLabelText("Work email")).toBeInTheDocument();
  });

  it("seeker-name: submits fullName to createSeekerProfileAction", async () => {
    vi.mocked(createSeekerProfileAction).mockResolvedValue({ ok: true });
    render(<OnboardFlow startingStep="seeker-name" />);
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Priya" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(createSeekerProfileAction).toHaveBeenCalledWith({ fullName: "Priya" }));
  });

  it("insider-name-email: on success, moves to the OTP step", async () => {
    vi.mocked(requestInsiderOtpAction).mockResolvedValue({ ok: true });
    render(<OnboardFlow startingStep="insider-name-email" />);
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Rahul" } });
    fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "r@acme.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    await waitFor(() => expect(screen.getByLabelText("Code")).toBeInTheDocument());
  });

  it("insider-name-email: on failure, shows the problem title and stays on this step", async () => {
    vi.mocked(requestInsiderOtpAction).mockResolvedValue({
      ok: false,
      problem: { type: "work-email-domain-not-registered", title: "We don't recognize that work email's domain yet." },
    });
    render(<OnboardFlow startingStep="insider-name-email" />);
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Rahul" } });
    fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "r@nope.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    await waitFor(() =>
      expect(screen.getByText("We don't recognize that work email's domain yet.")).toBeInTheDocument()
    );
    expect(screen.queryByLabelText("Code")).not.toBeInTheDocument();
  });

  it("otp: submits the code to verifyInsiderOtpAction", async () => {
    vi.mocked(verifyInsiderOtpAction).mockResolvedValue({ ok: true });
    render(<OnboardFlow startingStep="otp" />);
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(verifyInsiderOtpAction).toHaveBeenCalledWith({ code: "123456" }));
  });

  it("otp: Resend code calls resendInsiderOtpAction with no arguments, even on a resumed OTP step with no prior form state (spec §4.9 row 1)", async () => {
    vi.mocked(resendInsiderOtpAction).mockResolvedValue({ ok: true });
    render(<OnboardFlow startingStep="otp" />);
    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    await waitFor(() => expect(resendInsiderOtpAction).toHaveBeenCalledWith());
    expect(requestInsiderOtpAction).not.toHaveBeenCalled();
  });

  it("otp: Use a different email goes back to the Insider name+email step", () => {
    render(<OnboardFlow startingStep="otp" />);
    fireEvent.click(screen.getByRole("button", { name: "Use a different email" }));
    expect(screen.getByLabelText("Work email")).toBeInTheDocument();
  });
});
