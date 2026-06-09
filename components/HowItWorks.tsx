export function HowItWorks() {
  return (
    <>
      {/* Before / After Contrast */}
      <section className="band alt">
        <div className="band-head">
          <h2>Jobs go to the connected. Not just the qualified.</h2>
        </div>
        <div className="outcome-grid">

          {/* LEFT — stressed at desk, head droops in loop */}
          <div className="outcome-col ghost">
            <svg className="outcome-emoji" width="80" height="88" viewBox="0 0 80 88" fill="none" aria-hidden="true">
              <style>{`
                .oc-droop {
                  transform-box: fill-box;
                  transform-origin: center bottom;
                  animation: ocDroop 2.6s ease-in-out infinite;
                }
                @keyframes ocDroop {
                  0%, 30%  { transform: rotate(0deg); }
                  55%, 75% { transform: rotate(24deg); }
                  100%     { transform: rotate(0deg); }
                }
                @media (prefers-reduced-motion: reduce) {
                  .oc-droop { animation: none; }
                }
              `}</style>

              {/* desk surface */}
              <rect x="0" y="58" width="80" height="5" rx="2.5" fill="#fca5a5"/>
              {/* laptop screen */}
              <rect x="18" y="42" width="44" height="18" rx="3" fill="#fee2e2" stroke="#fca5a5" strokeWidth="1.5"/>
              <rect x="22" y="45" width="36" height="12" rx="2" fill="#fef2f2"/>
              {/* laptop base */}
              <rect x="14" y="62" width="52" height="3" rx="1.5" fill="#f87171"/>
              {/* arms resting on desk */}
              <rect x="5"  y="50" width="22" height="8" rx="4" fill="#fecaca" stroke="#f87171" strokeWidth="1"/>
              <rect x="53" y="50" width="22" height="8" rx="4" fill="#fecaca" stroke="#f87171" strokeWidth="1"/>
              {/* torso */}
              <rect x="28" y="30" width="24" height="20" rx="5" fill="#fecaca" stroke="#f87171" strokeWidth="1.5"/>
              {/* head — droops forward */}
              <g className="oc-droop">
                <circle cx="40" cy="17" r="12" fill="#fecaca" stroke="#f87171" strokeWidth="1.5"/>
                <ellipse cx="35.5" cy="16" rx="1.5" ry="2" fill="#dc2626"/>
                <ellipse cx="44.5" cy="16" rx="1.5" ry="2" fill="#dc2626"/>
                {/* frown */}
                <path d="M35.5 22 Q40 19.5 44.5 22" stroke="#dc2626" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
              </g>
            </svg>
            <div className="outcome-lbl">WITHOUT A REFERRAL</div>
            <div className="outcome-step">You apply</div>
            <div className="outcome-step">You wait</div>
            <div className="outcome-step">You hear nothing</div>
            <div className="outcome-step">You try again</div>
            <div className="outcome-pill">GHOSTED</div>
          </div>

          {/* RIGHT — celebrating, arms raise in loop */}
          <div className="outcome-col bright">
            <svg className="outcome-emoji" width="80" height="88" viewBox="0 0 80 88" fill="none" aria-hidden="true">
              <style>{`
                .oc-arm-l {
                  transform-box: fill-box;
                  transform-origin: right center;
                  animation: ocArmL 1.5s ease-in-out infinite;
                }
                .oc-arm-r {
                  transform-box: fill-box;
                  transform-origin: left center;
                  animation: ocArmR 1.5s ease-in-out infinite 0.2s;
                }
                @keyframes ocArmL {
                  0%, 100% { transform: rotate(0deg); }
                  50%      { transform: rotate(-58deg); }
                }
                @keyframes ocArmR {
                  0%, 100% { transform: rotate(0deg); }
                  50%      { transform: rotate(58deg); }
                }
                @media (prefers-reduced-motion: reduce) {
                  .oc-arm-l, .oc-arm-r { animation: none; }
                }
              `}</style>

              {/* legs */}
              <rect x="30" y="52" width="8" height="18" rx="4" fill="#bbf7d0" stroke="#4ade80" strokeWidth="1"/>
              <rect x="42" y="52" width="8" height="18" rx="4" fill="#bbf7d0" stroke="#4ade80" strokeWidth="1"/>
              {/* torso */}
              <rect x="28" y="32" width="24" height="22" rx="5" fill="#bbf7d0" stroke="#4ade80" strokeWidth="1.5"/>
              {/* left arm */}
              <g className="oc-arm-l">
                <rect x="5" y="32" width="25" height="8" rx="4" fill="#bbf7d0" stroke="#4ade80" strokeWidth="1"/>
              </g>
              {/* right arm */}
              <g className="oc-arm-r">
                <rect x="50" y="32" width="25" height="8" rx="4" fill="#bbf7d0" stroke="#4ade80" strokeWidth="1"/>
              </g>
              {/* head */}
              <circle cx="40" cy="17" r="12" fill="#bbf7d0" stroke="#4ade80" strokeWidth="1.5"/>
              <circle cx="35.5" cy="16" r="1.5" fill="#16a34a"/>
              <circle cx="44.5" cy="16" r="1.5" fill="#16a34a"/>
              {/* smile */}
              <path d="M35.5 19.5 Q40 25 44.5 19.5" stroke="#16a34a" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
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
