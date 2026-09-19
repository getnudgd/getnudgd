import type { ReactNode } from "react";
import Link from "next/link";

export default function SeekerLayout({ children }: { children: ReactNode }) {
  return (
    <div className="seeker-scope app-shell">
      <main className="app-shell-main">{children}</main>
      <nav className="app-shell-bottom-nav" aria-label="Primary">
        <Link href="/seeker/dashboard">Home</Link>
        <Link href="/seeker/insiders">Insiders</Link>
        <Link href="/seeker/requests">Requests</Link>
        <Link href="/seeker/profile">Profile</Link>
      </nav>
    </div>
  );
}
