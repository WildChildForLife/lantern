import { Trans } from "@lingui/react";
import { ChevronDown } from "lucide-react";
import type { FC } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/web/components/ui/collapsible";
import { cn } from "@/web/utils";
import type { SystemEntryLabel, SystemEntryPresentation } from "./systemEntryPresentation";

const SystemEntryHeading: FC<{ label: SystemEntryLabel }> = ({ label }) => {
  switch (label) {
    case "recap":
      return <Trans id="conversation.system.recap" />;
    case "notice":
      return <Trans id="conversation.system.notice" />;
    case "compacted":
      return <Trans id="conversation.system.compacted" />;
    case "api_error":
      return <Trans id="conversation.system.api_error" />;
    case "command_output":
      return <Trans id="conversation.system.command_output" />;
    case "turn_duration":
      return <Trans id="conversation.system.turn_duration" />;
    case "stop_hooks":
      return <Trans id="conversation.system.stop_hooks" />;
    case "generic":
      return <Trans id="conversation.system.generic" />;
    default:
      label satisfies never;
      return null;
  }
};

export const SystemConversationContent: FC<{ presentation: SystemEntryPresentation }> = ({
  presentation,
}) => {
  const { label, body, tone, defaultOpen } = presentation;
  const isError = tone === "error";

  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger asChild>
        <div
          className={cn(
            "flex items-center justify-between cursor-pointer hover:bg-muted/50 rounded p-2 -mx-2",
            isError && "border-l-2 border-red-400",
          )}
        >
          <h4
            className={cn(
              "text-xs font-medium",
              isError ? "text-red-600" : "text-muted-foreground",
            )}
          >
            <SystemEntryHeading label={label} />
          </h4>
          <ChevronDown className="h-3 w-3 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </div>
      </CollapsibleTrigger>
      {body !== "" && (
        <CollapsibleContent>
          <div
            className={cn(
              "bg-background rounded border p-3 mt-2",
              isError && "border-red-200 dark:border-red-900",
            )}
          >
            <pre className="text-xs overflow-x-auto whitespace-pre-wrap break-words">{body}</pre>
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
};
