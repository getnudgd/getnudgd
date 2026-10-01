import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/src/lib/current-user";
import { canAccessAdmin, canAccessInsiderApp } from "@/src/modules/identity/identity";
import { logoutAction } from "@/app/actions";

export default async function InsiderLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessAdmin(user) && !canAccessInsiderApp(user)) {
    redirect(user.insiderProfile !== null ? "/onboard" : "/onboard?add=insider");
  }

  return (
    <div className="insider-scope app-shell">
      <main className="app-shell-main">{children}</main>
      <nav className="app-shell-bottom-nav" aria-label="Primary">
        <Link href="/insider/dashboard">Home</Link>
        <Link href="/insider/requests">Inbox</Link>
        <Link href="/insider/rewards">Rewards</Link>
        <Link href="/insider/profile">Profile</Link>
        <form action={logoutAction}>
          <button type="submit">Log out</button>
        </form>
      </nav>
    </div>
  );
}
