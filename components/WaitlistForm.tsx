"use client";

import { useState } from "react";

const WA_MESSAGE = encodeURIComponent(
  "Hey! I just joined the GetNudgd waitlist. Get referred to your dream company 👉 getnudgd.com"
);
const WA_LINK = `https://wa.me/?text=${WA_MESSAGE}`;

type Variant = "hero" | "cta";

export function WaitlistForm({ variant = "hero" }: { variant?: Variant }) {
  const [role, setRole] = useState<"seeker" | "referrer">("seeker");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const val = email.trim();
    if (!val.includes("@") || !val.includes(".")) {
      setError(true);
      setTimeout(() => setError(false), 1400);
      return;
    }
    setLoading(true);
    try {
      await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: val, role }),
      });
    } catch {
      // fail silently — still show success to user
    }
    setLoading(false);
    setSuccess(true);
  }

  const isCta = variant === "cta";

  return (
    <div className={isCta ? "cta-form" : ""}>
      {!success ? (
        <>
          <div className="role-toggle" role="tablist">
            <button
              type="button"
              className={`role-btn ${role === "seeker" ? "active" : ""}`}
              onClick={() => setRole("seeker")}
            >
              Looking for a job
            </button>
            <button
              type="button"
              className={`role-btn ${role === "referrer" ? "active" : ""}`}
              onClick={() => setRole("referrer")}
            >
              I refer people
            </button>
          </div>
          <form className="email-row" onSubmit={handleSubmit} noValidate>
            <input
              className={`email-input${error ? " error" : ""}`}
              type="email"
              placeholder="your@email.com"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <button type="submit" className="submit-btn" disabled={loading}>
              {loading ? "Joining…" : isCta ? "Subscribe" : "Notify me"}
            </button>
          </form>
          <div className="wl-meta">
            <span>No spam, ever</span>
            <span className="dot" />
            <span>Unsubscribe any time</span>
          </div>
        </>
      ) : (
        <div className="wl-success">
          <h3 className="ok">{isCta ? "Done. We'll be in touch." : "You're on the list."}</h3>
          <p>
            {isCta
              ? "One email. When we're ready. That's the only promise we're making."
              : "We'll reach out the moment GetNudgd is ready. No noise in between."}
          </p>
          <div className="wl-share-row">
            <span className="wl-share-label">Share with a friend who needs this →</span>
            <a href={WA_LINK} target="_blank" rel="noopener noreferrer" className="btn-wa">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
              WhatsApp
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
