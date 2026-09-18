export type RequestState =
  | "SENT"
  | "ACCEPTED"
  | "DECLINED"
  | "EXPIRED"
  | "CANCELLED"
  | "PROOF_PENDING"
  | "SUBMITTED"
  | "INTERVIEW"
  | "COMPLETE"
  | "NO_INTERVIEW"
  | "CLOSED";

export type RequestEvent =
  | "accept"
  | "decline"
  | "expire"
  | "cancel"
  | "proof"
  | "reject"
  | "verify"
  | "interview"
  | "complete"
  | "windowExpiry"
  | "close";

export const TERMINAL_STATES: ReadonlySet<RequestState> = new Set([
  "DECLINED",
  "EXPIRED",
  "CANCELLED",
  "COMPLETE",
  "CLOSED",
]);

const TRANSITIONS: Record<RequestState, Partial<Record<RequestEvent, RequestState>>> = {
  SENT: { accept: "ACCEPTED", decline: "DECLINED", expire: "EXPIRED", cancel: "CANCELLED" },
  ACCEPTED: { proof: "PROOF_PENDING" },
  DECLINED: {},
  EXPIRED: {},
  CANCELLED: {},
  PROOF_PENDING: { reject: "ACCEPTED", verify: "SUBMITTED" },
  SUBMITTED: { interview: "INTERVIEW", windowExpiry: "NO_INTERVIEW" },
  INTERVIEW: { complete: "COMPLETE" },
  COMPLETE: {},
  NO_INTERVIEW: { close: "CLOSED" },
  CLOSED: {},
};

export class InvalidTransitionError extends Error {
  constructor(public readonly from: RequestState, public readonly event: RequestEvent) {
    super(`Cannot apply event "${event}" to request in state "${from}"`);
    this.name = "InvalidTransitionError";
  }
}

export function isTerminal(state: RequestState): boolean {
  return TERMINAL_STATES.has(state);
}

export function canApply(from: RequestState, event: RequestEvent): boolean {
  return TRANSITIONS[from]?.[event] !== undefined;
}

export function nextState(from: RequestState, event: RequestEvent): RequestState {
  const target = TRANSITIONS[from]?.[event];
  if (!target) throw new InvalidTransitionError(from, event);
  return target;
}

export const ALL_STATES = Object.keys(TRANSITIONS) as RequestState[];
export const ALL_EVENTS: RequestEvent[] = [
  "accept",
  "decline",
  "expire",
  "cancel",
  "proof",
  "reject",
  "verify",
  "interview",
  "complete",
  "windowExpiry",
  "close",
];
