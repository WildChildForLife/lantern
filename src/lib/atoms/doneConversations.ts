import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { useCallback, useMemo } from "react";

type DoneConversationStore = Record<string, true>;

/**
 * Conversations the user has ticked off in the "All conversations" list.
 * Stored in the browser rather than the cache DB: it is a personal reading
 * marker, not something derived from the Claude Code logs.
 */
const doneConversationsAtom = atomWithStorage<DoneConversationStore>(
  "claude-code-viewer-done-conversations",
  {},
);

export const useDoneConversations = () => {
  const [store, setStore] = useAtom(doneConversationsAtom);

  const isDone = useCallback((sessionId: string) => store[sessionId] === true, [store]);

  const setDone = useCallback(
    (sessionId: string, done: boolean) => {
      setStore((previous) => {
        const next = { ...previous };
        if (done) {
          next[sessionId] = true;
        } else {
          delete next[sessionId];
        }
        return next;
      });
    },
    [setStore],
  );

  const clearDone = useCallback(() => setStore({}), [setStore]);

  const doneCount = useMemo(() => Object.keys(store).length, [store]);

  return { isDone, setDone, clearDone, doneCount };
};
