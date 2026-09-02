import { useCallback, useMemo } from "react";
import type { Conversation, SidechainConversation } from "@/lib/conversation-schema";
import { isMessageEntry } from "@/lib/conversation-schema/entryVisibility";
import {
  SUBAGENT_TOOL_NAMES,
  taskToolInputSchema,
} from "../components/conversationList/AssistantConversationContent";

export const useSidechain = (conversations: Conversation[]) => {
  const sidechainConversations = useMemo(
    () => conversations.filter(isMessageEntry).filter((conv) => conv.isSidechain === true),
    [conversations],
  );

  const conversationMap = useMemo(() => {
    return new Map<string, SidechainConversation>(
      sidechainConversations.map((conv) => [conv.uuid, conv] as const),
    );
  }, [sidechainConversations]);

  const conversationPromptMap = useMemo(() => {
    const entries: Array<readonly [string, SidechainConversation]> = [];

    for (const conv of sidechainConversations) {
      if (conv.type !== "user" || conv.parentUuid !== null) {
        continue;
      }

      if (typeof conv.message.content !== "string") {
        continue;
      }

      entries.push([conv.message.content, conv] as const);
    }

    return new Map<string, SidechainConversation>(entries);
  }, [sidechainConversations]);

  const taskToolCallPromptSet = useMemo(() => {
    return new Set<string>(
      conversations
        .filter((conv) => conv.type === "assistant")
        .flatMap((conv) => conv.message.content.filter((content) => content.type === "tool_use"))
        .flatMap((content) => {
          if (!SUBAGENT_TOOL_NAMES.has(content.name)) {
            return [];
          }

          const input = taskToolInputSchema.safeParse(content.input);
          if (input.success === false) {
            return [];
          }

          return [input.data.prompt];
        }),
    );
  }, [conversations]);

  // The walk is a function of its own rather than the callback calling itself:
  // a `const` that refers to itself is only defined by the time it runs, which
  // is true here but is not something a reader — or the compiler — can see
  // locally.
  const getRootConversationRecursive = useCallback(
    (conversation: SidechainConversation): SidechainConversation => {
      const walkToRoot = (current: SidechainConversation): SidechainConversation => {
        if (current.parentUuid === null) {
          return current;
        }

        const parent = conversationMap.get(current.parentUuid);

        return parent === undefined ? current : walkToRoot(parent);
      };

      return walkToRoot(conversation);
    },
    [conversationMap],
  );

  const sidechainConversationGroups = useMemo(() => {
    const groups = new Map<string, SidechainConversation[]>();

    for (const conv of sidechainConversations) {
      const rootConversation = getRootConversationRecursive(conv);

      if (groups.has(rootConversation.uuid)) {
        groups.get(rootConversation.uuid)?.push(conv);
      } else {
        groups.set(rootConversation.uuid, [conv]);
      }
    }

    return groups;
  }, [sidechainConversations, getRootConversationRecursive]);

  const isRootSidechain = useCallback(
    (conversation: Conversation) => {
      if (!isMessageEntry(conversation)) {
        return false;
      }

      return sidechainConversationGroups.has(conversation.uuid);
    },
    [sidechainConversationGroups],
  );

  const getSidechainConversations = useCallback(
    (rootUuid: string) => {
      return sidechainConversationGroups.get(rootUuid) ?? [];
    },
    [sidechainConversationGroups],
  );

  const getSidechainConversationByPrompt = useCallback(
    (prompt: string) => {
      return conversationPromptMap.get(prompt);
    },
    [conversationPromptMap],
  );

  const conversationAgentIdMap = useMemo(() => {
    const entries: Array<readonly [string, SidechainConversation]> = [];

    for (const conv of sidechainConversations) {
      if (conv.type !== "user" && conv.type !== "system" && conv.type !== "assistant") {
        continue;
      }

      if (conv.parentUuid !== null || conv.agentId === undefined) {
        continue;
      }

      entries.push([conv.agentId, conv] as const);
    }

    return new Map<string, SidechainConversation>(entries);
  }, [sidechainConversations]);

  const getSidechainConversationByAgentId = useCallback(
    (agentId: string) => {
      return conversationAgentIdMap.get(agentId);
    },
    [conversationAgentIdMap],
  );

  const existsRelatedTaskCall = (prompt: string) => {
    return taskToolCallPromptSet.has(prompt);
  };

  return {
    isRootSidechain,
    getSidechainConversations,
    getSidechainConversationByPrompt,
    getSidechainConversationByAgentId,
    existsRelatedTaskCall,
  };
};
