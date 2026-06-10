import { WaitlistForm } from "./WaitlistForm";

export function CtaBand() {
  return (
    <div className="cta-band">
      <div className="cta-inner">
        <span className="label">Coming soon</span>
        <h2>Know the moment we launch</h2>
        <p>
          Something is coming for everyone who deserved it but didn&apos;t get
          it. One email when we are ready
        </p>
        <WaitlistForm variant="cta" />
      </div>
    </div>
  );
}
