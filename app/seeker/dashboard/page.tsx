import { getCurrentUser } from "@/src/lib/current-user";

export default async function SeekerDashboardPage() {
  const user = await getCurrentUser();
  return (
    <div>
      <h1>Seeker dashboard</h1>
      <p>Signed in as {user?.userId}</p>
    </div>
  );
}
