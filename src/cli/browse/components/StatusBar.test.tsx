import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import type { ConversationListEntry } from "../../../server/core/types.ts";
import type { BoardRow } from "../functions/buildColumns.ts";
import { StatusBar } from "./StatusBar.tsx";

const row = (overrides?: Partial<ConversationListEntry>): BoardRow => ({
  sessionId: "s-refund",
  projectId: "api",
  projectName: "api",
  projectPath: "/home/dev/lantern",
  source: "claude-code",
  title: "Add refunds",
  firstUserMessage: null,
  messageCount: 4,
  lastModifiedAt: "2026-08-06T00:00:00.000Z",
  modelName: "sonnet",
  totalCostUsd: 0.42,
  costConfidence: "estimated",
  topic: { id: "api", label: "API", icon: "plug" },
  displayTitle: "Add refunds",
  ...overrides,
});

describe("StatusBar", () => {
  it("draws every fact on one line, separated, whatever the colours", () => {
    const { lastFrame } = render(<StatusBar row={row()} status={null} width={120} />);

    expect(lastFrame()).toContain(
      "/home/dev/lantern · claude-code · sonnet · ~$0.42 · 4 messages · s-refund",
    );
  });

  it("names what it does not know rather than leaving a gap", () => {
    const { lastFrame } = render(
      <StatusBar
        row={row({ projectPath: null, projectName: null, modelName: null })}
        status={null}
        width={120}
      />,
    );

    expect(lastFrame()).toContain("unknown project · claude-code · unknown model");
  });

  it("shows a status instead of the detail while there is one", () => {
    const { lastFrame } = render(
      <StatusBar row={row()} status={{ text: "copied the id", tone: "ok" }} width={120} />,
    );

    expect(lastFrame()).toContain("copied the id");
    expect(lastFrame()).not.toContain("/home/dev/lantern");
  });

  it("says so when no conversation is selected", () => {
    const { lastFrame } = render(<StatusBar row={undefined} status={null} width={120} />);

    expect(lastFrame()).toContain("No conversation selected");
  });

  it("keeps the keys underneath, whichever line is above them", () => {
    const { lastFrame } = render(<StatusBar row={row()} status={null} width={120} />);

    expect(lastFrame()).toContain("←→ topics");
    expect(lastFrame()).toContain("q");
  });
});
