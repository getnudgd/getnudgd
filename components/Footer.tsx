import Image from "next/image";

export function Footer() {
  return (
    <footer className="foot">
      <div className="foot-inner">
        <Image src="/logo-light.png" alt="getnudgd" height={24} width={120} style={{ objectFit: "contain" }} />
        <div className="foot-meta">
          getnudgd.com · <b>Pre-launch</b> · Something real is coming.
        </div>
        <div className="foot-links">
          <a href="#">Privacy</a>
          <a href="#">Contact</a>
        </div>
      </div>
    </footer>
  );
}
