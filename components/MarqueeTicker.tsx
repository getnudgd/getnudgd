// Animation 4 — Marquee pain-point ticker (pure CSS, no library)
// Placed between Hero and SocialProof sections.

const ITEMS = [
  "300 applications. 4 replies.",
  "Right skills. Wrong college.",
  "Batchmate got in. You're still waiting.",
  "6.8 CGPA. Filtered before anyone read it.",
  "Cold-messaged 40 people. 2 replied.",
  "Final round. Then silence.",
  "Tier-2 city. Zero alumni network.",
  "Got referred. Never heard back.",
];

export function MarqueeTicker() {
  // Duplicate for seamless loop
  const all = [...ITEMS, ...ITEMS];

  return (
    <div className="marquee-strip" aria-hidden="true">
      <div className="marquee-track">
        {all.map((item, i) => (
          <span key={i} className="marquee-item">
            {item}
            <span className="marquee-sep">·</span>
          </span>
        ))}
      </div>
    </div>
  );
}
