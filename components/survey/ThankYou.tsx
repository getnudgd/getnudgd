import Link from "next/link";

export function ThankYou() {
  return (
    <div className="thankyou">
      <div className="ty-icon">🎉</div>
      <h2>You&apos;re a legend. Thank you!</h2>
      <p>
        Your response has been saved and goes directly to the founders. We&apos;re
        building GetNudgd for people exactly like you.
      </p>
      <div className="ty-pill">🚀 Early access on its way</div>
      <div style={{ marginTop: 24 }}>
        <Link
          href="/landing"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 24px",
            borderRadius: "var(--r-button)",
            background: "var(--indigo-600)",
            color: "#fff",
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: 15,
            textDecoration: "none",
            boxShadow: "var(--shadow-indigo)",
            transition: "background 0.15s ease",
          }}
        >
          Visit Website →
        </Link>
      </div>
      <div className="ty-foot">
        <em>Get referred. Not rejected.</em>
        <br />
        <span>getnudgd.com</span>
      </div>
    </div>
  );
}
