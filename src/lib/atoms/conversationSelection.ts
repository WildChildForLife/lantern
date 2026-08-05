import { atom, useAtom } from "jotai";
import { useCallback, useMemo } from "react";

/**
 * Which conversations the user has picked out, for whatever they are about to do
 * to them — tick them off, or have an agent CLI file them under a topic.
 *
 * Deliberately not persisted, unlike the done markers. A selection is the scope
 * of an action the user is in the middle of; restoring one after a reload would
 * mean a stale set sitting behind a button that costs money to press.
 */
export type ConversationSelection = {
  readonly selected: Readonly<Record<string, true>>;
  /** Where a shift-click measures from. */
  readonly anchorId: string | null;
};

export const emptyConversationSelection: ConversationSelection = { selected: {}, anchorId: null };

export const isConversationSelected = (state: ConversationSelection, sessionId: string): boolean =>
  state.selected[sessionId] === true;

export const conversationSelectionCount = (state: ConversationSelection): number =>
  Object.keys(state.selected).length;

export const setConversationSelected = (
  state: ConversationSelection,
  sessionId: string,
  selected: boolean,
): ConversationSelection => {
  const next = { ...state.selected };
  if (selected) {
    next[sessionId] = true;
  } else {
    delete next[sessionId];
  }

  // The anchor moves either way: after deselecting a row, a shift-click should
  // measure from where the user last was, not from wherever they were before.
  return { selected: next, anchorId: sessionId };
};

export const selectConversations = (
  state: ConversationSelection,
  sessionIds: readonly string[],
): ConversationSelection => {
  const next = { ...state.selected };
  for (const sessionId of sessionIds) next[sessionId] = true;

  return { selected: next, anchorId: sessionIds.at(-1) ?? state.anchorId };
};

/**
 * Adds everything between the anchor and `toId` inclusive, in the order the rows
 * are on screen. Additive, so a range never silently drops an earlier pick.
 *
 * With no usable anchor this is just selecting `toId` — which is what the first
 * shift-click in a fresh list should do.
 */
export const selectConversationRange = (
  state: ConversationSelection,
  orderedIds: readonly string[],
  toId: string,
): ConversationSelection => {
  const to = orderedIds.indexOf(toId);
  const from = state.anchorId === null ? -1 : orderedIds.indexOf(state.anchorId);
  if (to === -1 || from === -1) return setConversationSelected(state, toId, true);

  const [start, end] = from <= to ? [from, to] : [to, from];
  const next = { ...state.selected };
  for (const sessionId of orderedIds.slice(start, end + 1)) next[sessionId] = true;

  return { selected: next, anchorId: toId };
};

/**
 * The selection, narrowed to what is actually on screen and in that order.
 * Rows the user filtered away are not part of what a bulk action touches.
 */
export const selectedConversationsInOrder = (
  state: ConversationSelection,
  orderedIds: readonly string[],
): string[] => orderedIds.filter((sessionId) => isConversationSelected(state, sessionId));

const conversationSelectionAtom = atom<ConversationSelection>(emptyConversationSelection);

export const useConversationSelection = () => {
  const [state, setState] = useAtom(conversationSelectionAtom);

  const isSelected = useCallback(
    (sessionId: string) => isConversationSelected(state, sessionId),
    [state],
  );

  const setSelected = useCallback(
    (sessionId: string, selected: boolean) => {
      setState((previous) => setConversationSelected(previous, sessionId, selected));
    },
    [setState],
  );

  const selectRange = useCallback(
    (orderedIds: readonly string[], toId: string) => {
      setState((previous) => selectConversationRange(previous, orderedIds, toId));
    },
    [setState],
  );

  const selectAll = useCallback(
    (sessionIds: readonly string[]) => {
      setState((previous) => selectConversations(previous, sessionIds));
    },
    [setState],
  );

  const clearSelection = useCallback(() => setState(emptyConversationSelection), [setState]);

  const selectedInOrder = useCallback(
    (orderedIds: readonly string[]) => selectedConversationsInOrder(state, orderedIds),
    [state],
  );

  const selectedCount = useMemo(() => conversationSelectionCount(state), [state]);

  return {
    isSelected,
    setSelected,
    selectRange,
    selectAll,
    clearSelection,
    selectedInOrder,
    selectedCount,
  };
};
