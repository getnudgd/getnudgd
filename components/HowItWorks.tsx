import Image from "next/image";

export function HowItWorks() {
  return (
    <>
      {/* Before / After Contrast */}
      <section className="band alt">
        <div className="band-head">
          <h2>Jobs go to the connected. Not just the qualified.</h2>
        </div>
        <div className="outcome-grid">

          {/* LEFT — without a referral */}
          <div className="outcome-col ghost">
            <div className="outcome-emoji">
              <Image
                src="/undraw_dev-productivity_5wps.svg"
                alt=""
                width={180}
                height={130}
                style={{ objectFit: "contain" }}
                aria-hidden="true"
                unoptimized
              />
            </div>
            <div className="outcome-lbl">WITHOUT A REFERRAL</div>
            <div className="outcome-step">You apply</div>
            <div className="outcome-step">You wait</div>
            <div className="outcome-step">You hear nothing</div>
            <div className="outcome-step">You try again</div>
            <div className="outcome-pill">GHOSTED</div>
          </div>

          {/* RIGHT — with GetNudgd */}
          <div className="outcome-col bright">
            <div className="outcome-emoji">
              <Image
                src="/undraw_code-thinking_0vf2.svg"
                alt=""
                width={180}
                height={130}
                style={{ objectFit: "contain" }}
                aria-hidden="true"
                unoptimized
              />
            </div>
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
