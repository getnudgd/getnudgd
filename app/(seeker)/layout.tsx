import type { ReactNode } from "react";
import Link from "next/link";

export default function SeekerLayout({ children }: { children: ReactNode }) {
  return (
    <div className="seeker-scope app-shell">
      <main className="app-shell-main">{children}</main>
      <nav className="app-shell-bottom-nav" aria-label="Primary">
        <Link href="/dashboard">Home</Link>
        <Link href="/insiders">Insiders</Link>
        <Link href="/requests">Requests</Link>
        <Link href="/profile">Profile</Link>
      </nav>
    </div>
  );
}
