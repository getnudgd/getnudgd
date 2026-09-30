import { test, expect } from "@playwright/test";
import { notificationKey, waitUntil } from "./fixtures";

test("notificationKey composes eventKey:template:userId, matching notify()'s own key format", () => {
  expect(notificationKey("request:r1:decline", "request.declined", "u1")).toBe(
    "request:r1:decline:request.declined:u1"
  );
});

test("waitUntil resolves as soon as the predicate returns true", async () => {
  let calls = 0;
  await waitUntil(
    async () => {
      calls++;
      return calls >= 3;
    },
    5_000,
    "test predicate"
  );
  expect(calls).toBe(3);
});

test("waitUntil throws a descriptive error if the predicate never becomes true within the budget", async () => {
  await expect(
    waitUntil(async () => false, 300, "something that never happens")
  ).rejects.toThrow(/Timed out after 300ms waiting for: something that never happens/);
});
