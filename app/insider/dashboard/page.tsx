import { getCurrentUser } from "@/src/lib/current-user";

export default async function InsiderDashboardPage() {
  const user = await getCurrentUser();
  return (
    <div>
      <h1>Insider dashboard</h1>
      <p>Signed in as {user?.userId}</p>
    </div>
  );
}
