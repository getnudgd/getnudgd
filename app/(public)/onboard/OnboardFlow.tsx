"use client";

import { useState, useTransition, type FormEvent, type MouseEvent } from "react";
import { Chip } from "@/components/ui/Chip";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ErrorState } from "@/components/ui/ErrorState";
import {
  createSeekerProfileAction,
  requestInsiderOtpAction,
  resendInsiderOtpAction,
  verifyInsiderOtpAction,
} from "./actions";
import type { OnboardStep } from "./step";
import type { Problem } from "@/src/lib/problems";
import { brand } from "@/src/config/brand";

export function OnboardFlow({ startingStep }: { startingStep: OnboardStep }) {
  const [step, setStep] = useState<OnboardStep>(startingStep);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [isPending, startTransition] = useTransition();

  const [seekerFullName, setSeekerFullName] = useState("");
  const [insiderFullName, setInsiderFullName] = useState("");
  const [workEmail, setWorkEmail] = useState("");
  const [code, setCode] = useState("");

  function submitSeeker(e: FormEvent) {
    e.preventDefault();
    setProblem(null);
    startTransition(async () => {
      const result = await createSeekerProfileAction({ fullName: seekerFullName });
      if (!result.ok) setProblem(result.problem);
    });
  }

  function submitInsiderEmail(e: FormEvent) {
    e.preventDefault();
    setProblem(null);
    startTransition(async () => {
      const result = await requestInsiderOtpAction({ fullName: insiderFullName, workEmail });
      if (!result.ok) {
        setProblem(result.problem);
        return;
      }
      setStep("otp");
    });
  }

  function submitOtp(e: FormEvent) {
    e.preventDefault();
    setProblem(null);
    startTransition(async () => {
      const result = await verifyInsiderOtpAction({ code });
      if (!result.ok) setProblem(result.problem);
    });
  }

  function resend(e: MouseEvent) {
    e.preventDefault();
    setProblem(null);
    startTransition(async () => {
      // No form fields to send: this step may have been reached by resuming a reload
      // mid-flow (spec §4.9 row 1), where insiderFullName/workEmail were never filled in
      // this session. resendInsiderOtpAction re-sends to the already-stored work email.
      const result = await resendInsiderOtpAction();
      if (!result.ok) setProblem(result.problem);
    });
  }

  return (
    <div className="survey-wrap">
      {step === "role-choice" && (
        <div>
          <h1>How will you use {brand.name}?</h1>
          <div className="chips">
            <Chip onClick={() => setStep("seeker-name")}>I&apos;m looking for a job</Chip>
            <Chip onClick={() => setStep("insider-name-email")}>I&apos;m an Insider</Chip>
          </div>
        </div>
      )}

      {step === "seeker-name" && (
        <Card>
          <form onSubmit={submitSeeker} noValidate>
            <h1>What&apos;s your name?</h1>
            <label htmlFor="seeker-full-name">Full name</label>
            <Input
              id="seeker-full-name"
              value={seekerFullName}
              onChange={(e) => setSeekerFullName(e.target.value)}
              error={problem !== null}
              required
            />
            {problem && <ErrorState title={problem.title} />}
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving…" : "Continue"}
            </Button>
          </form>
        </Card>
      )}

      {step === "insider-name-email" && (
        <Card>
          <form onSubmit={submitInsiderEmail} noValidate>
            <h1>Verify your work email</h1>
            <label htmlFor="insider-full-name">Full name</label>
            <Input
              id="insider-full-name"
              value={insiderFullName}
              onChange={(e) => setInsiderFullName(e.target.value)}
              required
            />
            <label htmlFor="insider-work-email">Work email</label>
            <Input
              id="insider-work-email"
              type="email"
              autoComplete="email"
              value={workEmail}
              onChange={(e) => setWorkEmail(e.target.value)}
              error={problem !== null}
              required
            />
            {problem && <ErrorState title={problem.title} />}
            <Button type="submit" disabled={isPending}>
              {isPending ? "Sending…" : "Send code"}
            </Button>
          </form>
        </Card>
      )}

      {step === "otp" && (
        <Card>
          <form onSubmit={submitOtp} noValidate>
            <h1>Enter your code</h1>
            <p>We sent a 6-digit code to your work email.</p>
            <label htmlFor="insider-otp-code">Code</label>
            <Input
              id="insider-otp-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              error={problem !== null}
              required
            />
            {problem && <ErrorState title={problem.title} />}
            <Button type="submit" disabled={isPending}>
              {isPending ? "Verifying…" : "Verify"}
            </Button>
            <Button type="button" variant="ghost" onClick={resend} disabled={isPending}>
              Resend code
            </Button>
            <Button type="button" variant="ghost" onClick={() => setStep("insider-name-email")}>
              Use a different email
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
