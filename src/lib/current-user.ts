import { cache } from "react";
import "server-only";
import { getSessionFromCookies } from "./session";
import { getCurrentUserFromDb, type CurrentUser } from "../modules/identity/identity";
import { getAdapters } from "./adapters";

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await getSessionFromCookies();
  if (!session) return null;
  const { db } = getAdapters();
  return getCurrentUserFromDb({ db }, session.userId);
});
