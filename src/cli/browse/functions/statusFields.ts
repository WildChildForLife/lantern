import { formatCost } from "../../../lib/format/formatCost.ts";
import { theme } from "../../ui/theme.ts";
import type { BoardRow } from "./buildColumns.ts";

/**
 * One fact on the detail line, and the colour it is drawn in.
 *
 * `color` is null for anything that should recede rather than stand out: a fact
 * the logs do not carry, and the session id, which is there to be copied rather
 * than read.
 */
export type StatusField = {
  name: "project" | "source" | "model" | "cost" | "messages" | "id";
  text: string;
  color: string | null;
};

/**
 * A colour per field.
 *
 * The line is six facts run together, and any one of them can be the reason
 * someone looked down at it — a colour each is what lets the eye jump to the
 * model or the cost instead of reading left to right. Named colours, like the
 * topic columns, so a restricted palette still renders them and a themed
 * terminal is honoured rather than fought.
 */
const FIELD_COLOR = {
  project: "cyan",
  source: "magenta",
  model: "blue",
  cost: theme.ok,
  messages: theme.accent,
} as const;

/** What the status bar draws for the selected conversation, in order. */
export const statusFields = (row: BoardRow): StatusField[] => {
  const project = row.projectPath ?? row.projectName;

  return [
    {
      name: "project",
      text: project ?? "unknown project",
      color: project === null ? null : FIELD_COLOR.project,
    },
    { name: "source", text: row.source, color: FIELD_COLOR.source },
    {
      name: "model",
      text: row.modelName ?? "unknown model",
      color: row.modelName === null ? null : FIELD_COLOR.model,
    },
    {
      name: "cost",
      text: formatCost(row.totalCostUsd, row.costConfidence),
      color: FIELD_COLOR.cost,
    },
    {
      name: "messages",
      text: `${row.messageCount} messages`,
      color: FIELD_COLOR.messages,
    },
    { name: "id", text: row.sessionId, color: null },
  ];
};
