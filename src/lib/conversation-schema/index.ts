import { z } from "zod";
import { AgentNameEntrySchema } from "./entry/AgentNameEntrySchema.ts";
import { AgentSettingEntrySchema } from "./entry/AgentSettingEntrySchema.ts";
import { AiTitleEntrySchema } from "./entry/AiTitleEntrySchema.ts";
import { type AssistantEntry, AssistantEntrySchema } from "./entry/AssistantEntrySchema.ts";
import { AtisLatchEntrySchema } from "./entry/AtisLatchEntrySchema.ts";
import { AttachmentEntrySchema } from "./entry/AttachmentEntrySchema.ts";
import { CustomTitleEntrySchema } from "./entry/CustomTitleEntrySchema.ts";
import { FileHistoryDeltaEntrySchema } from "./entry/FileHistoryDeltaEntrySchema.ts";
import { FileHistorySnapshotEntrySchema } from "./entry/FileHIstorySnapshotEntrySchema.ts";
import { FrameLinkEntrySchema } from "./entry/FrameLinkEntrySchema.ts";
import { LastPromptEntrySchema } from "./entry/LastPromptEntrySchema.ts";
import { ModeEntrySchema } from "./entry/ModeEntrySchema.ts";
import { PermissionModeEntrySchema } from "./entry/PermissionModeEntrySchema.ts";
import { PrLinkEntrySchema } from "./entry/PrLinkEntrySchema.ts";
import { ProgressEntrySchema } from "./entry/ProgressEntrySchema.ts";
import { QueueOperationEntrySchema } from "./entry/QueueOperationEntrySchema.ts";
import { RelocatedEntrySchema } from "./entry/RelocatedEntrySchema.ts";
import { SummaryEntrySchema } from "./entry/SummaryEntrySchema.ts";
import { type SystemEntry, SystemEntrySchema } from "./entry/SystemEntrySchema.ts";
import { type UserEntry, UserEntrySchema } from "./entry/UserEntrySchema.ts";
import { WorktreeStateEntrySchema } from "./entry/WorktreeStateEntrySchema.ts";

export const ConversationSchema = z.union([
  UserEntrySchema,
  AssistantEntrySchema,
  SummaryEntrySchema,
  SystemEntrySchema,
  FileHistorySnapshotEntrySchema,
  QueueOperationEntrySchema,
  ProgressEntrySchema,
  CustomTitleEntrySchema,
  AiTitleEntrySchema,
  AgentNameEntrySchema,
  AgentSettingEntrySchema,
  PermissionModeEntrySchema,
  PrLinkEntrySchema,
  LastPromptEntrySchema,
  AttachmentEntrySchema,
  ModeEntrySchema,
  RelocatedEntrySchema,
  WorktreeStateEntrySchema,
  FileHistoryDeltaEntrySchema,
  FrameLinkEntrySchema,
  AtisLatchEntrySchema,
]);

export type Conversation = z.infer<typeof ConversationSchema>;
export type SidechainConversation = UserEntry | AssistantEntry | SystemEntry;
