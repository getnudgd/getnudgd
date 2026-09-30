import type { SessionPayload } from "./session";

export type Action = "read" | "update";
export type ResourceType = "seekerProfile" | "insiderProfile" | "userRecord" | "resume";

export interface Resource {
  type: ResourceType;
  ownerUserId: string;
}

export function authorize(session: Pick<SessionPayload, "userId" | "role"> | null, _action: Action, resource: Resource): boolean {
  if (!session) return false;
  if (session.role === "admin") return true;
  return session.userId === resource.ownerUserId;
}
