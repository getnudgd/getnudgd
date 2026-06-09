"use client";

// Animation 3 — Spring counter on stat numbers
// Animation 2 handled by FadeInSection wrapper in landing/page.tsx

import { useEffect, useRef, useState } from "react";
import { useInView, useMotionValue, useSpring } from "framer-motion";

interface StatCounterProps {
  to: number;
  suffix: string;
  colorClass?: string;
  startDelay?: number;
}

function StatCounter({ to, suffix, colorClass = "", startDelay = 0 }: StatCounterProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, amount: 0.5 });
  const motionVal = useMotionValue(0);
  const spring = useSpring(motionVal, { stiffness: 80, damping: 20 });
  const [displayed, setDisplayed] = useState(0);

  useEffect(() => {
    const unsub = spring.on("change", (v) => setDisplayed(Math.round(v)));
    return unsub;
  }, [spring]);

  useEffect(() => {
    if (isInView) {
      const t = setTimeout(() => motionVal.set(to), startDelay);
      return () => clearTimeout(t);
    }
  }, [isInView, motionVal, to, startDelay]);

  return (
    <div ref={ref} className={`stat-num ${colorClass}`}>
      <span>{displayed}</span>
      <span className="x">{suffix}</span>
    </div>
  );
}

export function SocialProof() {
  return (
    <section className="stats">
      <div className="stats-inner">
        <div className="stat">
          <StatCounter to={5} suffix="×" colorClass="indigo" startDelay={0} />
          <div className="stat-cap">
            more likely to land an interview when you&apos;re referred
          </div>
          <div className="stat-src">Source · LinkedIn data</div>
        </div>
        <div className="stat">
          <StatCounter to={70} suffix="%" startDelay={150} />
          <div className="stat-cap">
            of roles at top startups are filled through internal referrals
          </div>
          <div className="stat-src">Source · HR insights, 2024</div>
        </div>
        <div className="stat">
          <StatCounter to={3} suffix=" days" colorClass="amber" startDelay={300} />
          <div className="stat-cap">
            Full refund if your referrer does not act. No questions asked.
          </div>
          <div className="stat-src">GetNudgd guarantee</div>
        </div>
      </div>
    </section>
  );
}
