import { Loader2 } from "lucide-react";
import type { FC } from "react";
import { cn } from "@/web/utils";

export type LoadingProps = {
  /**
   * Message shown under the spinner. Optional.
   */
  message?: string;
  /**
   * Spinner size. Defaults to "default".
   */
  size?: "sm" | "default" | "lg";
  /**
   * Whether to fill the screen. Defaults to true.
   */
  fullScreen?: boolean;
  /**
   * Extra class names.
   */
  className?: string;
};

const sizeMap = {
  sm: "w-4 h-4",
  default: "w-8 h-8",
  lg: "w-12 h-12",
};

const textSizeMap = {
  sm: "text-sm",
  default: "text-base",
  lg: "text-lg",
};

export const Loading: FC<LoadingProps> = ({
  message,
  size = "default",
  fullScreen = true,
  className,
}) => {
  const content = (
    <div
      className={cn("flex flex-col items-center justify-center gap-3", className)}
      data-testid="loading-indicator"
    >
      <Loader2 className={cn(sizeMap[size], "animate-spin text-primary")} />
      {message !== undefined && message !== "" && (
        <p className={cn(textSizeMap[size], "text-muted-foreground font-medium")}>{message}</p>
      )}
    </div>
  );

  if (fullScreen) {
    return (
      <div className="flex items-center justify-center w-full h-full min-h-[400px]">{content}</div>
    );
  }

  return content;
};
