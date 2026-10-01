import { redirect } from "next/navigation";
import { getCurrentUser } from "@/src/lib/current-user";
import { resolveLanding } from "@/src/modules/identity/identity";
import { resolveStartingStep, type AddParam } from "./step";
import { OnboardFlow } from "./OnboardFlow";

export default async function OnboardPage({
  searchParams,
}: {
  searchParams: Promise<{ add?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { add: rawAdd } = await searchParams;
  const add: AddParam = rawAdd === "seeker" || rawAdd === "insider" ? rawAdd : undefined;

  const step = resolveStartingStep(user, add);
  if (step === null) redirect(resolveLanding(user));

  return <OnboardFlow startingStep={step} />;
}
