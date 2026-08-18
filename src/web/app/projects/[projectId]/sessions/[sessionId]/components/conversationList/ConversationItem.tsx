import { useLingui } from "@lingui/react";
import { type FC, memo } from "react";
import { parseUserMessage } from "@/lib/claude-code/parseUserMessage";
import type { Conversation, SidechainConversation } from "@/lib/conversation-schema";
import type { ToolResultContent } from "@/lib/conversation-schema/content/ToolResultContentSchema";
import type { AssistantMessageContent } from "@/lib/conversation-schema/message/AssistantMessageSchema";
import { formatLocaleDate } from "@/lib/date/formatLocaleDate";
import { DEFAULT_LOCALE } from "@/lib/i18n/localeDetection";
import { localeSchema, type SupportedLocale } from "@/lib/i18n/schema";
import { AssistantConversationContent } from "./AssistantConversationContent";
import { FileHistorySnapshotConversationContent } from "./FileHistorySnapshotConversationContent";
import { MetaConversationContent } from "./MetaConversationContent";
import { QueueOperationConversationContent } from "./QueueOperationConversationContent";
import { SummaryConversationContent } from "./SummaryConversationContent";
import { SystemConversationContent } from "./SystemConversationContent";
import { describeSystemEntry } from "./systemEntryPresentation";
import { TurnDuration } from "./TurnDuration";
import { UserConversationContent } from "./UserConversationContent";

type ConversationItemProps = {
  conversation: Conversation;
  getToolResult: (toolUseId: string) => ToolResultContent | undefined;
  getAgentIdForToolUse: (toolUseId: string) => string | undefined;
  getToolUseResult: (toolUseId: string) => unknown;
  getTurnDuration: (uuid: string) => number | undefined;
  isRootSidechain: (conversation: Conversation) => boolean;
  getSidechainConversationByAgentId: (agentId: string) => SidechainConversation | undefined;
  getSidechainConversationByPrompt: (prompt: string) => SidechainConversation | undefined;
  getSidechainConversations: (rootUuid: string) => SidechainConversation[];
  existsRelatedTaskCall: (prompt: string) => boolean;
  projectId: string;
  sessionId: string;
  showTimestamp?: boolean;
};

const ConversationItemComponent: FC<ConversationItemProps> = ({
  conversation,
  getToolResult,
  getAgentIdForToolUse,
  getToolUseResult,
  getTurnDuration,
  getSidechainConversationByPrompt,
  getSidechainConversations,
  getSidechainConversationByAgentId,
  projectId,
  sessionId,
  showTimestamp = true,
}) => {
  const { i18n } = useLingui();
  const localeResult = localeSchema.safeParse(i18n.locale);
  const locale: SupportedLocale = localeResult.success ? localeResult.data : DEFAULT_LOCALE;

  if (conversation.type === "summary") {
    return <SummaryConversationContent>{conversation.summary}</SummaryConversationContent>;
  }

  if (conversation.type === "system") {
    return <SystemConversationContent presentation={describeSystemEntry(conversation)} />;
  }

  if (conversation.type === "file-history-snapshot") {
    return <FileHistorySnapshotConversationContent conversation={conversation} />;
  }

  if (conversation.type === "queue-operation") {
    return <QueueOperationConversationContent conversation={conversation} />;
  }

  if (conversation.type === "user") {
    if (typeof conversation.message.content === "string") {
      const parsed = parseUserMessage(conversation.message.content);

      if (parsed.kind === "local-command") {
        const assistantContent: AssistantMessageContent = {
          type: "text",
          text: parsed.stdout,
        };

        return (
          <div className="w-full">
            {showTimestamp && conversation.timestamp && (
              <div className="text-xs text-muted-foreground mb-1 px-1 select-none text-left">
                {formatLocaleDate(conversation.timestamp, {
                  locale,
                  target: "datetime",
                })}
              </div>
            )}
            <ul className="w-full">
              <li>
                <AssistantConversationContent
                  content={assistantContent}
                  getToolResult={getToolResult}
                  getAgentIdForToolUse={getAgentIdForToolUse}
                  getToolUseResult={getToolUseResult}
                  getSidechainConversationByAgentId={getSidechainConversationByAgentId}
                  getSidechainConversationByPrompt={getSidechainConversationByPrompt}
                  getSidechainConversations={getSidechainConversations}
                  projectId={projectId}
                  sessionId={sessionId}
                />
              </li>
            </ul>
          </div>
        );
      }
    }

    const userConversationJsx =
      typeof conversation.message.content === "string" ? (
        <UserConversationContent
          content={conversation.message.content}
          id={`message-${conversation.uuid}`}
        />
      ) : (
        <ul className="w-full" id={`message-${conversation.uuid}`}>
          {conversation.message.content.map((content, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: Order is static
            <li key={index}>
              <UserConversationContent content={content} />
            </li>
          ))}
        </ul>
      );

    const timestamp =
      showTimestamp && conversation.timestamp ? (
        <div className="text-xs text-muted-foreground mb-1 px-1 select-none text-right">
          {formatLocaleDate(conversation.timestamp, {
            locale,
            target: "datetime",
          })}
        </div>
      ) : null;

    return conversation.isMeta === true ? (
      // Expandable, collapsed by default
      <MetaConversationContent>
        <div className="flex flex-col w-full">
          {timestamp}
          {userConversationJsx}
        </div>
      </MetaConversationContent>
    ) : (
      <div className="flex flex-col w-full">
        {timestamp}
        {userConversationJsx}
      </div>
    );
  }

  if (conversation.type === "assistant") {
    const renderableContent = conversation.message.content.filter((content) => {
      if (content.type === "thinking" && content.thinking === "") return false;
      if (content.type === "tool_result") return false;
      return true;
    });

    if (renderableContent.length === 0 && getTurnDuration(conversation.uuid) === undefined) {
      return null;
    }

    const turnDuration = getTurnDuration(conversation.uuid);
    return (
      <div className="w-full">
        {showTimestamp && conversation.timestamp && (
          <div className="text-xs text-muted-foreground mb-1 px-1 select-none text-left">
            {formatLocaleDate(conversation.timestamp, {
              locale,
              target: "datetime",
            })}
          </div>
        )}
        <ul className="w-full">
          {renderableContent.map((content, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: Order is static
            <li key={index}>
              <AssistantConversationContent
                content={content}
                getToolResult={getToolResult}
                getAgentIdForToolUse={getAgentIdForToolUse}
                getToolUseResult={getToolUseResult}
                getSidechainConversationByAgentId={getSidechainConversationByAgentId}
                getSidechainConversationByPrompt={getSidechainConversationByPrompt}
                getSidechainConversations={getSidechainConversations}
                projectId={projectId}
                sessionId={sessionId}
              />
            </li>
          ))}
        </ul>
        {turnDuration !== undefined && <TurnDuration durationMs={turnDuration} />}
      </div>
    );
  }

  return null;
};

export const ConversationItem = memo(ConversationItemComponent);
