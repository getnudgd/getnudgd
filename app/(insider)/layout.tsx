import type { ReactNode } from "react";
import Link from "next/link";

export default function InsiderLayout({ children }: { children: ReactNode }) {
  return (
    <div className="insider-scope app-shell">
      <main className="app-shell-main">{children}</main>
      <nav className="app-shell-bottom-nav" aria-label="Primary">
        <Link href="/dashboard">Home</Link>
        <Link href="/requests">Inbox</Link>
        <Link href="/rewards">Rewards</Link>
        <Link href="/profile">Profile</Link>
      </nav>
    </div>
  );
}
