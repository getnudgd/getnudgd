import { WaitlistForm } from "./WaitlistForm";

export function Hero() {
  return (
    <section className="hero">
      <div className="hero-grid">
        {/* Left column */}
        <div>
          <span className="hero-pill">
            <span className="hp-avs" aria-hidden="true">
              <span
                style={{
                  background: "linear-gradient(135deg,#6366F1,#4338CA)",
                }}
              />
              <span
                style={{
                  background: "linear-gradient(135deg,#F59E0B,#D97706)",
                }}
              />
              <span
                style={{
                  background: "linear-gradient(135deg,#10B981,#059669)",
                }}
              />
              <span
                style={{
                  background: "linear-gradient(135deg,#EC4899,#BE185D)",
                }}
              />
            </span>
            <span>
              <b>486</b> already subscribed
            </span>
          </span>

          <h1>
            Ek referral.
            <br />
            <em>Wahi kaafi hai.</em>
          </h1>

          <p className="hero-sub">
            Not a job board. A matchmaking platform. We connect you with someone
            on the inside, who puts your name forward.
          </p>

          {/* Waitlist card */}
          <div className="wl-card" id="waitlist">
            <div className="wl-card-head">
              <div className="wl-card-title">
                Be first to know when we launch.
              </div>
              <div className="wl-card-sub">
                We&apos;ll email you once, the day early access opens. That&apos;s it.
              </div>
            </div>
            <span className="label">I&apos;m here as</span>
            <WaitlistForm variant="hero" />
          </div>
        </div>

        {/* Right column: dark device mockup */}
        <div className="hero-device" aria-hidden="true">
          <div className="hd-bar">
            <i />
            <i />
            <i />
            <span className="hd-url">getnudgd.com</span>
          </div>
          <div className="hd-body">
            {/* Featured row */}
            <div className="hd-row featured">
              <div className="hd-av" />
              <div className="hd-lines">
                <div className="hd-line-a" />
                <div className="hd-line-b" />
              </div>
              <div className="hd-pill">Verified ✓</div>
            </div>

            {/* Blurred row 1 */}
            <div
              className="hd-row"
              style={{ filter: "blur(4px)", opacity: 0.45, pointerEvents: "none" }}
            >
              <div
                className="hd-av"
                style={{
                  background: "linear-gradient(135deg,#F59E0B,#D97706)",
                }}
              />
              <div className="hd-lines">
                <div
                  className="hd-line-a"
                  style={{
                    background: "rgba(255,255,255,0.16)",
                    width: "55%",
                  }}
                />
                <div
                  className="hd-line-b"
                  style={{
                    background: "rgba(255,255,255,0.08)",
                    width: "68%",
                  }}
                />
              </div>
              <div className="hd-pill amber">Open</div>
            </div>

            {/* Blurred row 2 */}
            <div
              className="hd-row"
              style={{ filter: "blur(7px)", opacity: 0.2, pointerEvents: "none" }}
            >
              <div
                className="hd-av"
                style={{
                  background: "linear-gradient(135deg,#10B981,#059669)",
                }}
              />
              <div className="hd-lines">
                <div
                  className="hd-line-a"
                  style={{
                    background: "rgba(255,255,255,0.12)",
                    width: "48%",
                  }}
                />
                <div
                  className="hd-line-b"
                  style={{
                    background: "rgba(255,255,255,0.06)",
                    width: "60%",
                  }}
                />
              </div>
              <div className="hd-pill">Verified ✓</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
