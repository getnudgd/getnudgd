import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/src/lib/current-user";
import { canAccessAdmin, canAccessSeekerApp } from "@/src/modules/identity/identity";
import { logoutAction } from "@/app/actions";

export default async function SeekerLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessAdmin(user) && !canAccessSeekerApp(user)) redirect("/onboard?add=seeker");

  return (
    <div className="seeker-scope app-shell">
      <main className="app-shell-main">{children}</main>
      <nav className="app-shell-bottom-nav" aria-label="Primary">
        <Link href="/seeker/dashboard">Home</Link>
        <Link href="/seeker/insiders">Insiders</Link>
        <Link href="/seeker/requests">Requests</Link>
        <Link href="/seeker/profile">Profile</Link>
        <form action={logoutAction}>
          <button type="submit">Log out</button>
        </form>
      </nav>
    </div>
  );
}
