export function HowItWorks() {
  return (
    <>
      {/* Before / After Contrast */}
      <section className="band alt">
        <div className="band-head">
          <h2>Jobs go to the connected. Not just the qualified.</h2>
        </div>
        <div className="outcome-grid">
          <div className="outcome-col ghost">
            {/* Stressed avatar at laptop — muted red tones */}
            <svg className="outcome-emoji" width="64" height="64" viewBox="0 0 64 64" fill="none" aria-hidden="true">
              <circle cx="32" cy="19" r="10" fill="#fecaca" stroke="#f87171" strokeWidth="1.5"/>
              <path d="M22 30 C22 27 26.5 25 32 25 C37.5 25 42 27 42 30 L42 38 L22 38 Z" fill="#fecaca" stroke="#f87171" strokeWidth="1.5"/>
              <rect x="10" y="38" width="44" height="18" rx="4" fill="#fee2e2" stroke="#fca5a5" strokeWidth="1.5"/>
              <rect x="14" y="41" width="36" height="12" rx="2" fill="#fef2f2"/>
              <rect x="6" y="56" width="52" height="4" rx="2" fill="#fca5a5"/>
              <path d="M27.5 21.5 Q32 20 36.5 21.5" stroke="#dc2626" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
              <circle cx="28" cy="18" r="1.5" fill="#dc2626"/>
              <circle cx="36" cy="18" r="1.5" fill="#dc2626"/>
            </svg>
            <div className="outcome-lbl">WITHOUT A REFERRAL</div>
            <div className="outcome-step">You apply</div>
            <div className="outcome-step">You wait</div>
            <div className="outcome-step">You hear nothing</div>
            <div className="outcome-step">You try again</div>
            <div className="outcome-pill">GHOSTED</div>
          </div>
          <div className="outcome-col bright">
            {/* Celebrating avatar — green tones, same character */}
            <svg className="outcome-emoji" width="64" height="64" viewBox="0 0 64 64" fill="none" aria-hidden="true">
              <circle cx="32" cy="19" r="10" fill="#bbf7d0" stroke="#4ade80" strokeWidth="1.5"/>
              <path d="M22 30 C22 27 26.5 25 32 25 C37.5 25 42 27 42 30 L42 46 L22 46 Z" fill="#bbf7d0" stroke="#4ade80" strokeWidth="1.5"/>
              <path d="M22 32 L8 16" stroke="#4ade80" strokeWidth="3" strokeLinecap="round"/>
              <path d="M42 32 L56 16" stroke="#4ade80" strokeWidth="3" strokeLinecap="round"/>
              <circle cx="8" cy="14" r="3.5" fill="#4ade80"/>
              <circle cx="56" cy="14" r="3.5" fill="#4ade80"/>
              <path d="M27.5 20.5 Q32 23 36.5 20.5" stroke="#16a34a" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
              <circle cx="28" cy="18" r="1.5" fill="#16a34a"/>
              <circle cx="36" cy="18" r="1.5" fill="#16a34a"/>
            </svg>
            <div className="outcome-lbl">WITH GETNUDGD</div>
            <div className="outcome-step">You get connected</div>
            <div className="outcome-step">Your name goes forward</div>
            <div className="outcome-step">You hear back</div>
            <div className="outcome-step">You get the interview</div>
            <div className="outcome-pill">REFERRED</div>
          </div>
        </div>
      </section>

      {/* Two Sides */}
      <section className="band alt">
        <div className="band-head">
          <span className="label" style={{ color: "var(--ink-500)" }}>
            Two sides, one platform
          </span>
          <h2>Pick your side. Both win.</h2>
        </div>
        <div className="sides">
          <div className="side seeker">
            <span className="side-for">For job seekers</span>
            <h3 className="side-h">The introduction that gets you in</h3>
            <p className="side-d">
              You bring the ambition. We make sure the right person on the
              inside knows your name.
            </p>
            <a href="#waitlist" className="side-cta">
              Notify me when ready
            </a>
          </div>
          <div className="side referrer">
            <span className="side-for">For referrers</span>
            <h3 className="side-h">Your reputation is worth real money</h3>
            <p className="side-d">
              You already know who is good. Vouch for the right people.
              Earn every time it works.
            </p>
            <a href="#waitlist" className="side-cta">
              Keep me posted
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
