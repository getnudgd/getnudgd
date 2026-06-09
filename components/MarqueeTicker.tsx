// Animation 4 — Premium dark marquee ticker
// Structure: static "REAL STORIES" label | scrolling pain-point text

const ITEMS = [
  "300 applications. 4 replies",
  "Right skills, wrong college",
  "Batchmate got in, you're still waiting",
  "Filtered before anyone read it",
  "Cold-messaged 40 people, 2 replied",
  "Final round, then silence",
  "Zero alumni network",
  "Got referred, never heard back",
];

export function MarqueeTicker() {
  // Two full copies → translateX(-50%) creates a seamless loop
  const all = [...ITEMS, ...ITEMS];

  return (
    <div className="marquee-strip">
      {/* Static label — hidden on mobile */}
      <div className="marquee-label" aria-hidden="true">
        Real Stories
      </div>

      {/* Scrolling track */}
      <div className="marquee-scroll" aria-hidden="true">
        <div className="marquee-track">
          {all.map((item, i) => (
            <span key={i} className="marquee-item">
              {item}
              <span className="marquee-sep" aria-hidden="true">◆</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
