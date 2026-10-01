export type OnboardStep = "otp" | "seeker-name" | "insider-name-email" | "role-choice";
export type AddParam = "seeker" | "insider" | undefined;

interface OnboardUserState {
  seekerProfileId: string | null;
  insiderProfile: { verifiedAt: Date | null } | null;
}

/** Mirrors spec §4.9's ordered table exactly. Returns null when row 5 fires: fully onboarded, no matching add — the caller redirects via resolveLanding. */
export function resolveStartingStep(user: OnboardUserState, add: AddParam): OnboardStep | null {
  if (user.insiderProfile !== null && user.insiderProfile.verifiedAt === null) return "otp";
  if (add === "seeker" && user.seekerProfileId === null) return "seeker-name";
  if (add === "insider" && user.insiderProfile === null) return "insider-name-email";
  if (user.seekerProfileId === null && user.insiderProfile === null) return "role-choice";
  return null;
}
