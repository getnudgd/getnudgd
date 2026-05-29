import { WaitlistForm } from "./WaitlistForm";

export function CtaBand() {
  return (
    <div className="cta-band">
      <div className="cta-inner">
        <span className="label">Coming soon</span>
        <h2>Want to know the moment we launch?</h2>
        <p>
          India&apos;s referral matchmaking platform. Launching soon. Leave your
          email. One message when we&apos;re ready.
        </p>
        <WaitlistForm variant="cta" />
      </div>
    </div>
  );
}
