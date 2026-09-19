import type { ReactNode } from "react";
import Link from "next/link";

export default function InsiderLayout({ children }: { children: ReactNode }) {
  return (
    <div className="insider-scope app-shell">
      <main className="app-shell-main">{children}</main>
      <nav className="app-shell-bottom-nav" aria-label="Primary">
        <Link href="/insider/dashboard">Home</Link>
        <Link href="/insider/requests">Inbox</Link>
        <Link href="/insider/rewards">Rewards</Link>
        <Link href="/insider/profile">Profile</Link>
      </nav>
    </div>
  );
}
