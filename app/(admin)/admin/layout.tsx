import type { ReactNode } from "react";
import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/src/lib/current-user";
import { canAccessAdmin } from "@/src/modules/identity/identity";
import { logoutAction } from "@/app/actions";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessAdmin(user)) notFound();

  return (
    <div className="admin-shell">
      {children}
      <form action={logoutAction}>
        <button type="submit">Log out</button>
      </form>
    </div>
  );
}
