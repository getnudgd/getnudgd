import type { AuthAdapter } from "./types";
import { InvalidTokenError } from "./types";

/**
 * Always rejects. Selected for NODE_ENV=production until a real Firebase
 * adapter exists, so a production deployment can never accept the fake
 * adapter's forged base64url tokens — independent of ADAPTERS,
 * DEV_LOGIN_ENABLED, or any route existing at all.
 */
export function createRefusingAuthAdapter(): { adapter: AuthAdapter } {
  return {
    adapter: {
      async verifyIdToken(_idToken: string): Promise<never> {
        throw new InvalidTokenError();
      },
    },
  };
}
