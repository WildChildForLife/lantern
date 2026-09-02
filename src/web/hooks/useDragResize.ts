import {
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

type ResizePosition = { clientX: number; clientY: number };

type DragResizeOptions = {
  onResize: (position: ResizePosition) => void;
  onResizeStart?: () => void;
  onResizeEnd?: () => void;
  enabled?: boolean;
};

export const useDragResize = ({
  onResize,
  onResizeStart,
  onResizeEnd,
  enabled = true,
}: DragResizeOptions) => {
  const [isResizing, setIsResizing] = useState(false);
  const isResizingRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const latestPositionRef = useRef<ResizePosition | null>(null);

  const stopResizing = useCallback(() => {
    isResizingRef.current = false;
    setIsResizing(false);
    onResizeEnd?.();
  }, [onResizeEnd]);

  const startResizing = useCallback(() => {
    isResizingRef.current = true;
    setIsResizing(true);
    onResizeStart?.();
  }, [onResizeStart]);

  const handleMouseDown = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      startResizing();
    },
    [startResizing],
  );

  const handleTouchStart = useCallback(
    (event: ReactTouchEvent) => {
      event.stopPropagation();
      startResizing();
    },
    [startResizing],
  );

  useEffect(() => {
    if (!enabled) {
      // Deliberately an effect, not a correction made during render.
      // `stopResizing` calls the caller's `onResizeEnd`, and a parent callback
      // run during this component's render is free to set state in the parent —
      // which is a worse thing than the extra render this costs.
      // oxlint-disable-next-line react/set-state-in-effect
      stopResizing();
      return;
    }

    const scheduleResize = () => {
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        const latestPosition = latestPositionRef.current;
        if (!latestPosition) return;
        onResize(latestPosition);
      });
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (!isResizingRef.current) return;
      event.preventDefault();
      latestPositionRef.current = { clientX: event.clientX, clientY: event.clientY };
      scheduleResize();
    };

    const handleMouseUp = (event: MouseEvent) => {
      event.preventDefault();
      stopResizing();
    };

    const handleMouseLeave = () => {
      stopResizing();
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!isResizingRef.current) return;
      event.preventDefault();
      const touch = event.touches[0];
      if (!touch) return;
      latestPositionRef.current = { clientX: touch.clientX, clientY: touch.clientY };
      scheduleResize();
    };

    const handleTouchEnd = () => {
      stopResizing();
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopResizing();
      }
    };

    const handleBlur = () => {
      stopResizing();
    };

    document.addEventListener("mousemove", handleMouseMove, { passive: false });
    document.addEventListener("mouseup", handleMouseUp, { passive: false });
    document.addEventListener("mouseleave", handleMouseLeave);
    document.addEventListener("touchmove", handleTouchMove, { passive: false });
    document.addEventListener("touchend", handleTouchEnd);
    document.addEventListener("touchcancel", handleTouchEnd);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleBlur);

    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("mouseleave", handleMouseLeave);
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleTouchEnd);
      document.removeEventListener("touchcancel", handleTouchEnd);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleBlur);
    };
  }, [enabled, onResize, stopResizing]);

  return { isResizing, handleMouseDown, handleTouchStart };
};
