import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { useCallback, useMemo } from "react";
import { storageKey } from "./storageKey";

export type DoneConversationStore = Record<string, true>;

/**
 * Ticks a batch of conversations off, or un-ticks them. Pure so the bulk and
 * single-row paths cannot drift apart.
 */
export const updateDoneConversationStore = (
  store: DoneConversationStore,
  sessionIds: readonly string[],
  done: boolean,
): DoneConversationStore => {
  const next = { ...store };
  for (const sessionId of sessionIds) {
    if (done) {
      next[sessionId] = true;
    } else {
      delete next[sessionId];
    }
  }
  return next;
};

/**
 * Conversations the user has ticked off in the "All conversations" list.
 * Stored in the browser rather than the cache DB: it is a personal reading
 * marker, not something derived from the Claude Code logs.
 */
const doneConversationsAtom = atomWithStorage<DoneConversationStore>(
  storageKey("done-conversations"),
  {},
);

export const useDoneConversations = () => {
  const [store, setStore] = useAtom(doneConversationsAtom);

  const isDone = useCallback((sessionId: string) => store[sessionId] === true, [store]);

  const setDone = useCallback(
    (sessionId: string, done: boolean) => {
      setStore((previous) => updateDoneConversationStore(previous, [sessionId], done));
    },
    [setStore],
  );

  /** The bulk action behind the selection bar. */
  const setManyDone = useCallback(
    (sessionIds: readonly string[], done: boolean) => {
      setStore((previous) => updateDoneConversationStore(previous, sessionIds, done));
    },
    [setStore],
  );

  const clearDone = useCallback(() => setStore({}), [setStore]);

  const doneCount = useMemo(() => Object.keys(store).length, [store]);

  return { isDone, setDone, setManyDone, clearDone, doneCount };
};
