export interface VerifiedIdentity {
  providerUid: string;
  email: string;
}

export interface AuthAdapter {
  verifyIdToken(idToken: string): Promise<VerifiedIdentity>;
}

export class InvalidTokenError extends Error {
  constructor() {
    super("Invalid or expired ID token");
    this.name = "InvalidTokenError";
  }
}
