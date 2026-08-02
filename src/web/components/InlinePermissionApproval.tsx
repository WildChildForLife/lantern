import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, RotateCcw, ShieldAlert, X } from "lucide-react";
import { type FC, useState } from "react";
import { formatLocaleDate } from "@/lib/date/formatLocaleDate";
import type { PermissionRequest, PermissionResponse } from "@/types/permissions";
import { useConfig } from "@/web/app/hooks/useConfig";
import { getToolVisualizer } from "@/web/app/projects/[projectId]/sessions/[sessionId]/components/conversationList/toolVisualizers";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";
import { generatePermissionRuleQuery } from "@/web/lib/api/queries";

type InlinePermissionApprovalProps = {
  permissionRequest: PermissionRequest | null;
  onResponse: (response: PermissionResponse) => Promise<void>;
};

const basename = (filePath: string): string => filePath.split("/").at(-1) ?? filePath;

const describeGitSubcommand = (args: readonly string[]): string => {
  switch (args[0]?.toLowerCase() ?? "") {
    case "commit":
      return "wants to commit";
    case "push":
      return "wants to push";
    case "pull":
      return "wants to pull";
    case "clone":
      return "wants to clone a repository";
    case "checkout":
    case "switch":
      return "wants to switch branch";
    case "branch":
      return "wants to work with branches";
    case "merge":
      return "wants to merge";
    case "rebase":
      return "wants to rebase";
    case "add":
      return "wants to stage changes";
    case "status":
      return "wants to check the git status";
    case "log":
      return "wants to read the git log";
    case "diff":
      return "wants to view a diff";
    case "reset":
      return "wants to reset changes";
    case "stash":
      return "wants to stash changes";
    case "fetch":
      return "wants to fetch from the remote";
    default:
      return "wants to run a git command";
  }
};

const describePackageManagerSubcommand = (args: readonly string[]): string => {
  switch (args[0]?.toLowerCase() ?? "") {
    case "install":
    case "add":
    case "i":
      return "wants to install packages";
    case "uninstall":
    case "remove":
    case "rm":
      return "wants to remove packages";
    case "update":
    case "upgrade":
      return "wants to update packages";
    case "run":
      return args[1] !== undefined ? `wants to run the ${args[1]} script` : "wants to run a script";
    case "build":
      return "wants to run a build";
    case "test":
      return "wants to run the tests";
    case "lint":
      return "wants to run the linter";
    default:
      return "wants to manage packages";
  }
};

const describeBashCommand = (command: string): string => {
  const firstSegment = command.split(/\s*(?:&&|\|\||;)\s*/)[0]?.trim() ?? command;
  const tokens = firstSegment.trim().split(/\s+/);

  // Skip sudo and env var assignments (VAR=value)
  let idx = 0;
  while (idx < tokens.length) {
    const token = tokens[idx] ?? "";
    if (token === "sudo" || token === "env" || token.includes("=")) {
      idx++;
    } else {
      break;
    }
  }

  const baseCmd = tokens[idx]?.toLowerCase() ?? "";
  const args = tokens.slice(idx + 1).filter((t) => !t.startsWith("-"));
  const firstArg = args[0];

  switch (baseCmd) {
    case "rm":
    case "rmdir":
      return firstArg !== undefined ? `wants to delete ${firstArg}` : "wants to delete a file";
    case "ls":
      return firstArg !== undefined
        ? `wants to inspect the folder ${firstArg}`
        : "wants to inspect a folder";
    case "mkdir":
      return firstArg !== undefined
        ? `wants to create the folder ${firstArg}`
        : "wants to create a folder";
    case "cp":
      return "wants to copy a file";
    case "mv":
      return "wants to move a file";
    case "cat":
      return firstArg !== undefined ? `wants to inspect ${firstArg}` : "wants to inspect a file";
    case "touch":
      return firstArg !== undefined ? `wants to create ${firstArg}` : "wants to create a file";
    case "find":
      return "wants to search for files";
    case "grep":
    case "rg":
      return "wants to search inside files";
    case "git":
      return describeGitSubcommand(args);
    case "npm":
    case "pnpm":
    case "yarn":
    case "bun":
      return describePackageManagerSubcommand(args);
    case "curl":
    case "wget":
      return "wants to download a file";
    case "chmod":
    case "chown":
      return "wants to change file permissions";
    case "kill":
    case "killall":
    case "pkill":
      return "wants to kill a process";
    case "ps":
      return "wants to inspect processes";
    case "docker":
      return "wants to run a Docker command";
    case "ssh":
      return "wants to connect to a remote server";
    case "make":
      return "wants to run a build";
    case "python":
    case "python3":
      return "wants to run a Python script";
    case "node":
    case "npx":
    case "tsx":
    case "ts-node":
      return "wants to run a script";
    case "echo":
      return "wants to print text";
    case "cd":
      return firstArg !== undefined
        ? `wants to change into ${firstArg}`
        : "wants to change directory";
    case "tar":
    case "zip":
    case "unzip":
    case "gzip":
      return "wants to work with an archive";
    case "open":
      return firstArg !== undefined ? `wants to open ${firstArg}` : "wants to open a file";
    default:
      return "wants to run a command";
  }
};

const describePermissionRequest = (
  toolName: string,
  toolInput: Record<string, unknown>,
): string => {
  switch (toolName.toLowerCase()) {
    case "read": {
      if (typeof toolInput["file_path"] === "string") {
        return `wants to read ${basename(toolInput["file_path"])}`;
      }
      return "wants to read a file";
    }
    case "write": {
      if (typeof toolInput["file_path"] === "string") {
        return `wants to write ${basename(toolInput["file_path"])}`;
      }
      return "wants to write a file";
    }
    case "edit":
    case "multiedit": {
      if (typeof toolInput["file_path"] === "string") {
        return `wants to edit ${basename(toolInput["file_path"])}`;
      }
      return "wants to edit a file";
    }
    case "bash": {
      if (typeof toolInput["command"] === "string") {
        return describeBashCommand(toolInput["command"]);
      }
      return "wants to run a command";
    }
    case "glob": {
      if (typeof toolInput["pattern"] === "string") {
        return `wants to find files matching ${toolInput["pattern"]}`;
      }
      return "wants to search for files";
    }
    case "grep": {
      if (typeof toolInput["pattern"] === "string") {
        return `wants to search files for "${toolInput["pattern"]}"`;
      }
      return "wants to search inside files";
    }
    case "ls": {
      if (typeof toolInput["path"] === "string") {
        return `wants to inspect the folder ${toolInput["path"]}`;
      }
      return "wants to inspect a folder";
    }
    case "webfetch": {
      return "wants to fetch a web page";
    }
    case "websearch": {
      if (typeof toolInput["query"] === "string") {
        return `wants to search for "${toolInput["query"]}"`;
      }
      return "wants to search the web";
    }
    case "notebookread": {
      if (typeof toolInput["notebook_path"] === "string") {
        return `wants to read ${basename(toolInput["notebook_path"])}`;
      }
      return "wants to read a notebook";
    }
    case "notebookedit": {
      if (typeof toolInput["notebook_path"] === "string") {
        return `wants to edit ${basename(toolInput["notebook_path"])}`;
      }
      return "wants to edit a notebook";
    }
    case "todowrite": {
      return "wants to update the task list";
    }
    case "agent": {
      if (typeof toolInput["description"] === "string") {
        return `wants to start a subagent (${toolInput["description"]})`;
      }
      return "wants to start a subagent";
    }
    default: {
      // MCP tools: mcp__serverName__toolName
      if (toolName.toLowerCase().startsWith("mcp__")) {
        const parts = toolName.split("__");
        const serverName = parts[1] ?? "";
        const toolPart = parts.slice(2).join("__");
        return `wants to run ${toolPart} on ${serverName}`;
      }
      return `wants to run ${toolName}`;
    }
  }
};

const formatParamValue = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return String(value);
  return JSON.stringify(value, null, 2);
};

const ToolPreview: FC<{
  permissionRequest: PermissionRequest;
}> = ({ permissionRequest }) => {
  const Visualizer = getToolVisualizer(permissionRequest.toolName);

  if (Visualizer !== undefined) {
    return (
      <div className="rounded-lg border border-border/60 overflow-hidden max-h-64 overflow-y-auto">
        <Visualizer
          toolUseId=""
          input={permissionRequest.toolInput}
          output={undefined}
          toolUseResult={undefined}
        />
      </div>
    );
  }

  // Inline parameters — no collapsible, max-height for overflow
  const entries = Object.entries(permissionRequest.toolInput);
  if (entries.length === 0) return null;

  return (
    <div className="rounded-lg border border-border/60 overflow-hidden max-h-48 overflow-y-auto">
      <div className="px-3.5 py-2.5 space-y-2">
        {entries.map(([key, value]) => (
          <div key={key} className="space-y-0.5">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              {key}
            </span>
            <pre className="text-xs font-mono whitespace-pre-wrap break-words leading-relaxed text-foreground/80 bg-muted/60 rounded-md border border-border/40 px-2.5 py-1.5 max-h-32 overflow-y-auto">
              {formatParamValue(value)}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
};

export const InlinePermissionApproval: FC<InlinePermissionApprovalProps> = ({
  permissionRequest,
  onResponse,
}) => {
  const [isResponding, setIsResponding] = useState(false);
  // null = not edited by user (use fetchedRule as-is)
  // string = user edited the rule
  const [editedRule, setEditedRule] = useState<string | null>(null);
  const { config } = useConfig();

  const ruleQuery = useQuery({
    ...generatePermissionRuleQuery(
      permissionRequest?.toolName ?? "",
      permissionRequest?.toolInput ?? {},
      permissionRequest?.projectId ?? "",
    ),
    enabled: permissionRequest !== null,
  });

  if (!permissionRequest) return null;

  const fetchedRule =
    ruleQuery.data !== undefined && "rule" in ruleQuery.data ? (ruleQuery.data.rule ?? "") : "";

  // Derived: current rule to display and to send
  const currentRule = editedRule ?? fetchedRule;
  // If user has edited the rule, "Allow once" is ambiguous — disable it
  const isRuleModified = editedRule !== null;

  const handleResponse = async (decision: "allow" | "deny") => {
    setIsResponding(true);
    try {
      await onResponse({ permissionRequestId: permissionRequest.id, decision });
    } finally {
      setIsResponding(false);
    }
  };

  const handleAlwaysAllow = async (scope: "session" | "project") => {
    setIsResponding(true);
    try {
      await onResponse({
        permissionRequestId: permissionRequest.id,
        decision: "always_allow",
        alwaysAllowRule: currentRule,
        alwaysAllowScope: scope,
      });
    } finally {
      setIsResponding(false);
    }
  };

  return (
    <div className="mx-4 sm:mx-6 md:mx-8 lg:mx-12 xl:mx-16 mb-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="rounded-xl border border-orange-500/25 bg-card shadow-sm overflow-hidden">
        {/* Header bar */}
        <div className="px-4 py-2.5 border-b border-border/60 bg-orange-500/[0.04]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex items-center justify-center size-6 rounded-md bg-orange-500/10 text-orange-600 dark:text-orange-400">
                <ShieldAlert className="size-3.5" />
              </div>
              <span className="text-sm font-semibold">Permission Request</span>
            </div>
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatLocaleDate(permissionRequest.timestamp, {
                locale: config.locale,
                target: "time",
              })}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1.5 ml-[2.125rem]">
            {describePermissionRequest(permissionRequest.toolName, permissionRequest.toolInput)}
          </p>
        </div>

        <div className="p-4 space-y-3">
          {/* Tool name */}
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="font-mono text-xs tracking-tight">
              {permissionRequest.toolName}
            </Badge>
          </div>

          {/* Tool Visualizer or Parameters Section */}
          <ToolPreview permissionRequest={permissionRequest} />

          {/* Always Allow Rule — editable, shown by default */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground shrink-0">Always Allow Rule:</span>
            {ruleQuery.isLoading ? (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                Generating...
              </div>
            ) : (
              <Input
                value={currentRule}
                onChange={(e) => setEditedRule(e.target.value)}
                className="font-mono text-xs h-7 flex-1"
                placeholder="Permission rule..."
              />
            )}
            {isRuleModified && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditedRule(null)}
                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground shrink-0"
                title="Reset to generated rule"
              >
                <RotateCcw className="size-3.5" />
              </Button>
            )}
          </div>

          {/* Action Buttons — 1-click, 4 direct options */}
          <div className="flex gap-2.5 justify-end pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleResponse("deny")}
              disabled={isResponding}
              className="min-w-[4.5rem] gap-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            >
              <X className="size-3.5" />
              Deny
            </Button>
            <Button
              size="sm"
              onClick={() => void handleResponse("allow")}
              disabled={isResponding || isRuleModified}
              className="min-w-[4.5rem] gap-1.5"
            >
              <Check className="size-3.5" />
              Allow
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleAlwaysAllow("session")}
              disabled={isResponding || ruleQuery.isLoading || currentRule === ""}
              className="min-w-[5.5rem] gap-1.5"
            >
              <Check className="size-3.5" />
              Session
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleAlwaysAllow("project")}
              disabled={isResponding || ruleQuery.isLoading || currentRule === ""}
              className="min-w-[5.5rem] gap-1.5"
            >
              <Check className="size-3.5" />
              Project
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
