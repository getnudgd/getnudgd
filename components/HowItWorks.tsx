export function HowItWorks() {
  return (
    <>
      {/* Before / After Contrast */}
      <section className="band alt reveal">
        <div className="band-head">
          <span className="label">Before · After</span>
          <h2>Same ambition. Completely different outcome.</h2>
        </div>
        <div className="outcome-grid">
          <div className="outcome-col ghost">
            <div className="outcome-lbl">Without a referral</div>
            <div className="outcome-step">You apply.</div>
            <div className="outcome-step">You wait.</div>
            <div className="outcome-step">You hear nothing.</div>
            <div className="outcome-step">You try again.</div>
            <div className="outcome-pill">Ghosted</div>
          </div>
          <div className="outcome-col bright">
            <div className="outcome-lbl">With GetNudgd</div>
            <div className="outcome-step">You get connected.</div>
            <div className="outcome-step">Your name goes forward.</div>
            <div className="outcome-step">You hear back.</div>
            <div className="outcome-step">You get the interview.</div>
            <div className="outcome-pill">Referred</div>
          </div>
        </div>
      </section>

      {/* Two Sides */}
      <section className="band alt reveal">
        <div className="band-head">
          <span className="label" style={{ color: "var(--ink-500)" }}>
            Two sides, one platform
          </span>
          <h2>Pick your side. Both win.</h2>
        </div>
        <div className="sides">
          <div className="side seeker">
            <span className="side-for">For job seekers</span>
            <h3 className="side-h">
              The introduction that{" "}
              <span className="accent-i">gets you in.</span>
            </h3>
            <p className="side-d">
              You bring your ambition. We make sure the right person on the
              inside knows your name.
            </p>
            <a href="#waitlist" className="side-cta">
              Notify me when ready
            </a>
          </div>
          <div className="side referrer">
            <span className="side-for">For referrers</span>
            <h3 className="side-h">
              Your reputation is worth{" "}
              <span className="accent-a">real money.</span>
            </h3>
            <p className="side-d">
              You already know who&apos;s good. Vouch for the right people.
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
