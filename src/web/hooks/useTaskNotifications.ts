import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { notificationSettingsAtom, soundNotificationsEnabledAtom } from "@/lib/atoms/notifications";
import { playNotificationSound } from "@/lib/notifications";
import { abortedByUserSessionIdsAtom } from "@/web/app/projects/[projectId]/sessions/[sessionId]/store/sessionProcessesAtom";

/**
 * Hook to handle task completion sound notifications
 * Monitors task state changes and triggers sound when tasks complete.
 * Suppresses notifications when the task was aborted by the user.
 */
export const useTaskNotifications = (isRunningTask: boolean, sessionId: string) => {
  const settings = useAtomValue(notificationSettingsAtom);
  const soundEnabled = useAtomValue(soundNotificationsEnabledAtom);
  const abortedByUserSessionIds = useAtomValue(abortedByUserSessionIdsAtom);
  const setAbortedByUserSessionIds = useSetAtom(abortedByUserSessionIdsAtom);

  // Track previous running state to detect completion
  const prevIsRunningRef = useRef<boolean>(isRunningTask);
  const prevSessionIdRef = useRef<string>(sessionId);

  // Monitor task state changes
  useEffect(() => {
    // A session change resets what "was running" means, so that switching away
    // from a running session cannot read as that session having finished. Done
    // here rather than during render because `sessionId` is one of this
    // effect's dependencies: a session can never change without this running,
    // so there is nothing a render-time reset would catch that this does not.
    const sessionChanged = prevSessionIdRef.current !== sessionId;
    prevSessionIdRef.current = sessionId;

    const prevIsRunning = sessionChanged ? isRunningTask : prevIsRunningRef.current;
    prevIsRunningRef.current = isRunningTask;

    // Detect task completion: was running, now not running.
    if (prevIsRunning && !isRunningTask) {
      // Suppress toast/sound when the user explicitly aborted the task
      if (abortedByUserSessionIds.has(sessionId)) {
        // Clean up the tracked abort entry
        setAbortedByUserSessionIds((prev: Set<string>) => {
          const next = new Set(prev);
          next.delete(sessionId);
          return next;
        });
        return;
      }

      toast.success("Task completed");

      if (soundEnabled) {
        // Play notification sound
        playNotificationSound(settings.soundType);
      }
    }
    // sessionId is what makes the reset above reliable, and
    // abortedByUserSessionIds is re-read so abort tracking follows the session.
  }, [
    isRunningTask,
    soundEnabled,
    settings.soundType,
    abortedByUserSessionIds,
    sessionId,
    setAbortedByUserSessionIds,
  ]);
};
