// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationSelectionBar } from "./ConversationSelectionBar";

vi.mock("@lingui/react", () => ({
  Trans: ({ message }: { message: string }) => <span>{message}</span>,
  useLingui: () => ({
    i18n: {
      _: ({ message, values }: { message: string; values?: Record<string, unknown> }) =>
        Object.entries(values ?? {}).reduce(
          (text, [key, value]) => text.replace(`{${key}}`, String(value)),
          message,
        ),
    },
  }),
}));

vi.mock("lucide-react", () => ({
  CheckCheckIcon: () => <span data-testid="done-icon" />,
  Loader2Icon: () => <span data-testid="spinner" />,
  SparklesIcon: () => <span data-testid="sparkles" />,
  XIcon: () => <span data-testid="clear-icon" />,
}));

const defaultProps = {
  selectedCount: 2,
  visibleCount: 50,
  allVisibleSelected: false,
  isClassifying: false,
  exceedsPassCap: false,
  onSelectAllVisible: () => {},
  onClear: () => {},
  onMarkDone: () => {},
  onMarkNotDone: () => {},
  onSortSelected: () => {},
};

describe("ConversationSelectionBar", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  const renderBar = (props: Partial<typeof defaultProps> = {}) => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(<ConversationSelectionBar {...defaultProps} {...props} />);
    });
  };

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    container?.remove();
    container = null;
    vi.clearAllMocks();
  });

  it("says how many are selected", () => {
    renderBar({ selectedCount: 7 });

    expect(
      container?.querySelector("[data-testid='conversation-selection-count']")?.textContent,
    ).toBe("7 selected");
  });

  it("offers select-all until everything visible is picked", () => {
    renderBar({ allVisibleSelected: false });
    expect(container?.textContent).toContain("Select all 50");

    act(() => {
      root?.render(<ConversationSelectionBar {...defaultProps} allVisibleSelected={true} />);
    });
    expect(container?.textContent).not.toContain("Select all");
  });

  it("blocks a second pass while one is running", () => {
    renderBar({ isClassifying: true });

    const sort = container?.querySelector("[data-testid='conversation-selection-sort']");
    expect(sort?.hasAttribute("disabled")).toBe(true);
    expect(container?.querySelector("[data-testid='spinner']")).not.toBeNull();
  });

  it("warns about the per-pass cap before the sort is clicked", () => {
    renderBar({ exceedsPassCap: false });
    expect(container?.querySelector("[data-testid='conversation-selection-cap']")).toBeNull();

    act(() => {
      root?.render(<ConversationSelectionBar {...defaultProps} exceedsPassCap={true} />);
    });
    expect(
      container?.querySelector("[data-testid='conversation-selection-cap']")?.textContent,
    ).toContain("240");
  });

  it("refuses to sort when nothing actionable is picked", () => {
    // Happens when every selected conversation is filtered out of view. Asking
    // anyway would send an empty request and earn a rejection.
    renderBar({ selectedCount: 0 });

    expect(
      container
        ?.querySelector("[data-testid='conversation-selection-sort']")
        ?.hasAttribute("disabled"),
    ).toBe(true);
  });

  it("routes each button to its own callback", () => {
    const onMarkDone = vi.fn();
    const onMarkNotDone = vi.fn();
    const onSortSelected = vi.fn();
    const onClear = vi.fn();
    renderBar({ onMarkDone, onMarkNotDone, onSortSelected, onClear });

    const click = (selector: string) => {
      act(() => {
        container
          ?.querySelector(selector)
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    };

    click("[data-testid='conversation-selection-sort']");
    expect(onSortSelected).toHaveBeenCalledTimes(1);
    expect(onMarkDone).not.toHaveBeenCalled();
    expect(onMarkNotDone).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();

    const buttons = [...(container?.querySelectorAll("button") ?? [])];
    const byText = (text: string) => buttons.find((button) => button.textContent?.includes(text));

    byText("Mark as done")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onMarkDone).toHaveBeenCalledTimes(1);

    byText("Mark as not done")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onMarkNotDone).toHaveBeenCalledTimes(1);

    byText("Clear selection")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
