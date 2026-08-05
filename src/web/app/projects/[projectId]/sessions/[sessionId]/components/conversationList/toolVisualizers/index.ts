import { AskUserQuestionVisualizer } from "./AskUserQuestionVisualizer";
import { BashVisualizer } from "./BashVisualizer";
import { EditVisualizer } from "./EditVisualizer";
import { ReadVisualizer } from "./ReadVisualizer";
import { TaskManagementVisualizer } from "./TaskManagementVisualizer";
import { TaskVisualizer } from "./TaskVisualizer";
import { TodoWriteVisualizer } from "./TodoWriteVisualizer";
import type { ToolVisualizerComponent } from "./types";
import { WriteVisualizer } from "./WriteVisualizer";

const TOOL_VISUALIZERS: Record<string, ToolVisualizerComponent> = {
  Bash: BashVisualizer,
  Edit: EditVisualizer,
  Read: ReadVisualizer,
  Write: WriteVisualizer,
  Task: TaskVisualizer,
  Agent: TaskVisualizer,
  TaskCreate: TaskManagementVisualizer,
  TaskUpdate: TaskManagementVisualizer,
  TodoWrite: TodoWriteVisualizer,
  LanternAskUserQuestion: AskUserQuestionVisualizer,
  // Sessions recorded before the tool was renamed still carry the old name.
  CCVAskUserQuestion: AskUserQuestionVisualizer,
};

export const getToolVisualizer = (toolName: string): ToolVisualizerComponent | undefined => {
  return TOOL_VISUALIZERS[toolName];
};
