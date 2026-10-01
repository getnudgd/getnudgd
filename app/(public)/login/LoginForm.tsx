"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ErrorState } from "@/components/ui/ErrorState";
import { devLoginAction } from "./actions";
import type { Problem } from "@/src/lib/problems";

type Step = "email" | "code";

export function LoginForm() {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [problem, setProblem] = useState<Problem | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleContinue(e: FormEvent) {
    e.preventDefault();
    if (!email.includes("@")) {
      setProblem({ type: "validation-failed", title: "Enter a valid email address." });
      return;
    }
    setProblem(null);
    setStep("code");
  }

  function handleVerify(e: FormEvent) {
    e.preventDefault();
    setProblem(null);
    startTransition(async () => {
      const result = await devLoginAction({ email, code });
      if (!result.ok) setProblem(result.problem);
    });
  }

  return (
    <div className="survey-wrap">
      <h1>Sign in</h1>
      {step === "email" ? (
        <form onSubmit={handleContinue} noValidate>
          <label htmlFor="login-email">Email</label>
          <Input
            id="login-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={problem !== null}
            required
          />
          {problem && <ErrorState title={problem.title} />}
          <Button type="submit">Continue</Button>
        </form>
      ) : (
        <form onSubmit={handleVerify} noValidate>
          <p>Enter the 6-digit code sent to {email}.</p>
          <label htmlFor="login-code">Code</label>
          <Input
            id="login-code"
            type="text"
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
            {isPending ? "Verifying…" : "Sign in"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setStep("email")}>
            Use a different email
          </Button>
        </form>
      )}
    </div>
  );
}
