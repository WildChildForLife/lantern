import { expect, test } from "vitest";
import { updateDoneConversationStore } from "./doneConversations";

test("ticks a conversation off", () => {
  expect(updateDoneConversationStore({}, ["a"], true)).toEqual({ a: true });
});

test("un-ticks a conversation", () => {
  expect(updateDoneConversationStore({ a: true, b: true }, ["a"], false)).toEqual({ b: true });
});

test("ticks a whole batch off in one go", () => {
  expect(updateDoneConversationStore({ a: true }, ["b", "c"], true)).toEqual({
    a: true,
    b: true,
    c: true,
  });
});

test("un-ticking something that was never ticked changes nothing", () => {
  expect(updateDoneConversationStore({ a: true }, ["unknown"], false)).toEqual({ a: true });
});

test("leaves the store it was given alone", () => {
  const store = { a: true } as const;
  const snapshot = { ...store };

  updateDoneConversationStore(store, ["b"], true);
  updateDoneConversationStore(store, ["a"], false);

  expect(store).toEqual(snapshot);
});

test("an empty batch is a no-op", () => {
  expect(updateDoneConversationStore({ a: true }, [], true)).toEqual({ a: true });
});
