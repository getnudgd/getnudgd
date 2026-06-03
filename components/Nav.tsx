import Link from "next/link";

export function Nav() {
  return (
    <header className="wl-nav">
      <div className="wl-nav-inner">
        <Link href="/" className="wl-brand">
          <span className="wl-brand-get">get</span>
          <span className="wl-brand-nudgd">nudgd</span>
        </Link>
<a href="#waitlist" className="btn btn-primary btn-sm">
          Get notified
        </a>
      </div>
    </header>
  );
}
