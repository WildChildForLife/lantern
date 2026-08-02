import { CheckIcon, CopyIcon } from "lucide-react";
import { type FC, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/web/utils";

type Props = {
  sessionId: string;
  className?: string;
};

/**
 * Copies the raw session id so it can be resumed straight from a terminal with
 * `claude --resume <id>`.
 */
export const CopySessionIdButton: FC<Props> = ({ sessionId, className }) => {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(sessionId);
      setCopied(true);
      toast.success("Conversation ID copied");
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy conversation ID");
    }
  };

  return (
    <button
      type="button"
      title={`Copy conversation ID (${sessionId})`}
      aria-label="Copy conversation ID"
      onClick={() => {
        void handleCopy();
      }}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded transition-colors text-muted-foreground hover:bg-muted hover:text-foreground shrink-0",
        className,
      )}
    >
      {copied ? (
        <CheckIcon className="h-3.5 w-3.5 text-green-500" />
      ) : (
        <CopyIcon className="h-3.5 w-3.5" />
      )}
    </button>
  );
};
