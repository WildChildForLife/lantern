import { Link, useCanGoBack, useRouter } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";
import type { FC } from "react";

type Props = {
  className: string;
};

/**
 * Goes back to wherever the conversation was opened from - the topic table, a
 * filtered conversation list, the project page - instead of always landing on
 * the project list, which loses the view the user was working in.
 */
export const BackButton: FC<Props> = ({ className }) => {
  const router = useRouter();
  const canGoBack = useCanGoBack();

  if (!canGoBack) {
    return (
      <Link to="/topics" className={className}>
        <ArrowLeftIcon className="w-4 h-4 text-sidebar-foreground/70" />
      </Link>
    );
  }

  return (
    <button type="button" className={className} onClick={() => router.history.back()}>
      <ArrowLeftIcon className="w-4 h-4 text-sidebar-foreground/70" />
    </button>
  );
};
