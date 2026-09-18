import { describe, it, expect } from "vitest";
import {
  nextState,
  canApply,
  isTerminal,
  InvalidTransitionError,
  ALL_STATES,
  ALL_EVENTS,
  TERMINAL_STATES,
  type RequestState,
  type RequestEvent,
} from "./state";

const EXPECTED: Partial<Record<RequestState, Partial<Record<RequestEvent, RequestState>>>> = {
  SENT: { accept: "ACCEPTED", decline: "DECLINED", expire: "EXPIRED", cancel: "CANCELLED" },
  ACCEPTED: { proof: "PROOF_PENDING" },
  PROOF_PENDING: { reject: "ACCEPTED", verify: "SUBMITTED" },
  SUBMITTED: { interview: "INTERVIEW", windowExpiry: "NO_INTERVIEW" },
  INTERVIEW: { complete: "COMPLETE" },
  NO_INTERVIEW: { close: "CLOSED" },
};

describe("requests/state exhaustive transition table", () => {
  for (const state of ALL_STATES) {
    for (const event of ALL_EVENTS) {
      const expected = EXPECTED[state]?.[event];
      if (expected) {
        it(`${state} --${event}--> ${expected}`, () => {
          expect(nextState(state, event)).toBe(expected);
          expect(canApply(state, event)).toBe(true);
        });
      } else {
        it(`${state} --${event}--> rejected`, () => {
          expect(() => nextState(state, event)).toThrow(InvalidTransitionError);
          expect(canApply(state, event)).toBe(false);
        });
      }
    }
  }

  it("marks exactly the five terminal states", () => {
    for (const state of ALL_STATES) {
      expect(isTerminal(state)).toBe(TERMINAL_STATES.has(state));
    }
    expect([...TERMINAL_STATES].sort()).toEqual(["CANCELLED", "CLOSED", "COMPLETE", "DECLINED", "EXPIRED"]);
  });

  it("property: random walks from SENT never reach an undefined state, and terminal states admit no further events", () => {
    let seed = 7;
    function nextRandom(): number {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    }

    for (let run = 0; run < 50; run++) {
      let state: RequestState = "SENT";
      for (let step = 0; step < 20; step++) {
        if (isTerminal(state)) {
          for (const event of ALL_EVENTS) expect(canApply(state, event)).toBe(false);
          break;
        }
        const event = ALL_EVENTS[Math.floor(nextRandom() * ALL_EVENTS.length)];
        if (canApply(state, event)) {
          state = nextState(state, event);
          expect(ALL_STATES).toContain(state);
        } else {
          expect(() => nextState(state, event)).toThrow(InvalidTransitionError);
        }
      }
    }
  });
});
