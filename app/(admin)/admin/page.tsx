import { getCurrentUser } from "@/src/lib/current-user";

export default async function AdminIndexPage() {
  const user = await getCurrentUser();
  return (
    <div>
      <h1>Admin</h1>
      <p>Signed in as {user?.userId}</p>
    </div>
  );
}
