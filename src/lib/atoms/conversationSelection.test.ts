import { expect, test } from "vitest";
import {
  type ConversationSelection,
  conversationSelectionCount,
  deselectConversations,
  emptyConversationSelection,
  isConversationSelected,
  selectConversationRange,
  selectConversations,
  selectedConversationsInOrder,
  setConversationSelected,
} from "./conversationSelection";

const rows = ["a", "b", "c", "d", "e"];

const selection = (
  ids: readonly string[],
  anchorId: string | null = null,
): ConversationSelection => ({
  selected: Object.fromEntries(ids.map((id) => [id, true] as const)),
  anchorId,
});

test("starts with nothing selected", () => {
  expect(conversationSelectionCount(emptyConversationSelection)).toBe(0);
  expect(isConversationSelected(emptyConversationSelection, "a")).toBe(false);
});

test("selects and deselects one conversation", () => {
  const picked = setConversationSelected(emptyConversationSelection, "a", true);
  expect(isConversationSelected(picked, "a")).toBe(true);

  const dropped = setConversationSelected(picked, "a", false);
  expect(isConversationSelected(dropped, "a")).toBe(false);
  expect(conversationSelectionCount(dropped)).toBe(0);
});

test("moves the anchor whichever way the row was toggled", () => {
  expect(setConversationSelected(emptyConversationSelection, "c", true).anchorId).toBe("c");
  expect(setConversationSelected(selection(["c"], "a"), "c", false).anchorId).toBe("c");
});

test("selects a range forwards from the anchor", () => {
  const next = selectConversationRange(selection(["b"], "b"), rows, "d");

  expect(selectedConversationsInOrder(next, rows)).toEqual(["b", "c", "d"]);
  expect(next.anchorId).toBe("d");
});

test("selects a range backwards from the anchor", () => {
  const next = selectConversationRange(selection(["d"], "d"), rows, "b");

  expect(selectedConversationsInOrder(next, rows)).toEqual(["b", "c", "d"]);
  expect(next.anchorId).toBe("b");
});

test("a range adds to what was already picked", () => {
  const next = selectConversationRange(selection(["a", "c"], "c"), rows, "d");

  expect(selectedConversationsInOrder(next, rows)).toEqual(["a", "c", "d"]);
});

test("a range with no usable anchor just picks the row", () => {
  expect(
    selectedConversationsInOrder(
      selectConversationRange(emptyConversationSelection, rows, "c"),
      rows,
    ),
  ).toEqual(["c"]);
  // Anchor pointing at a row that has since been filtered away.
  expect(
    selectedConversationsInOrder(selectConversationRange(selection([], "gone"), rows, "c"), rows),
  ).toEqual(["c"]);
});

test("a range to a row that is not on screen falls back to picking that row", () => {
  const next = selectConversationRange(selection(["a"], "a"), rows, "not-here");

  expect(isConversationSelected(next, "not-here")).toBe(true);
  // Nothing between the anchor and an off-screen row was swept up.
  expect(selectedConversationsInOrder(next, rows)).toEqual(["a"]);
});

test("selects everything visible at once", () => {
  const next = selectConversations(emptyConversationSelection, rows);

  expect(conversationSelectionCount(next)).toBe(5);
  expect(next.anchorId).toBe("e");
});

test("drops a batch while leaving the rest picked", () => {
  // What a capped pass needs: the ones it covered leave, the remainder stays so
  // pressing again continues instead of redoing what was just paid for.
  const next = deselectConversations(selection(["a", "b", "c"], "c"), ["a", "b"]);

  expect(selectedConversationsInOrder(next, rows)).toEqual(["c"]);
  expect(next.anchorId).toBe("c");
});

test("deselecting ids that were never picked changes nothing", () => {
  expect(deselectConversations(selection(["a"]), ["b", "unknown"]).selected).toEqual({ a: true });
});

test("reports the selection in the order the rows are on screen", () => {
  expect(selectedConversationsInOrder(selection(["d", "a", "c"]), rows)).toEqual(["a", "c", "d"]);
});

test("drops selected ids that are no longer on screen", () => {
  expect(selectedConversationsInOrder(selection(["a", "filtered-away"]), rows)).toEqual(["a"]);
});

test("leaves the state it was given alone", () => {
  const state = selection(["a"], "a");
  const snapshot = structuredClone(state);

  setConversationSelected(state, "b", true);
  selectConversationRange(state, rows, "d");
  selectConversations(state, rows);
  deselectConversations(state, ["a"]);

  expect(state).toEqual(snapshot);
});
