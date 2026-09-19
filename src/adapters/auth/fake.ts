import type { AuthAdapter, VerifiedIdentity } from "./types";
import { InvalidTokenError } from "./types";

export function createFakeAuthAdapter(): { adapter: AuthAdapter; issueToken(identity: VerifiedIdentity): string } {
  return {
    adapter: {
      async verifyIdToken(idToken: string): Promise<VerifiedIdentity> {
        let decoded: unknown;
        try {
          decoded = JSON.parse(Buffer.from(idToken, "base64url").toString("utf8"));
        } catch {
          throw new InvalidTokenError();
        }
        if (
          typeof decoded !== "object" ||
          decoded === null ||
          typeof (decoded as VerifiedIdentity).providerUid !== "string" ||
          typeof (decoded as VerifiedIdentity).email !== "string"
        ) {
          throw new InvalidTokenError();
        }
        return decoded as VerifiedIdentity;
      },
    },
    issueToken(identity: VerifiedIdentity): string {
      return Buffer.from(JSON.stringify(identity)).toString("base64url");
    },
  };
}
