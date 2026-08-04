import { describe, expect, it } from "vitest";
import { claudeCodeSourceAdapter } from "../adapters/claude-code/ClaudeCodeSourceAdapter.ts";
import { codexSourceAdapter } from "../adapters/codex/CodexSourceAdapter.ts";
import { opencodeSourceAdapter } from "../adapters/opencode/OpencodeSourceAdapter.ts";
import { ALL_SOURCE_ADAPTERS } from "../services/SourceRegistry.ts";

/**
 * The contract topic naming depends on: given the CLI the user picked, the
 * registry hands back a runner that knows how to ask it one question and read
 * the answer back. Each CLI differs in all three respects, and getting any of
 * them wrong looks like the model gave a bad answer rather than like a bug.
 */
describe("headless runners", () => {
  it("offers one for every registered source", () => {
    // A source with no headless runner falls back to keyword grouping, which is
    // a decision worth making deliberately rather than by omission.
    const missing = ALL_SOURCE_ADAPTERS.filter((adapter) => adapter.headless === undefined).map(
      (adapter) => adapter.id,
    );

    expect(missing).toStrictEqual([]);
  });

  it("puts the prompt where each CLI expects it", () => {
    for (const adapter of ALL_SOURCE_ADAPTERS) {
      const runner = adapter.headless;
      if (runner === undefined) continue;

      const args = runner.args("name these topics");

      // Every one of these takes the prompt as a bare argument. A CLI that
      // wanted it on stdin instead would hang forever with no terminal.
      expect(args, adapter.id).toContain("name these topics");
    }
  });

  it("reads Claude Code's envelope, including what it cost", () => {
    const runner = claudeCodeSourceAdapter.headless;
    if (runner === undefined) throw new Error("claude-code should offer a runner");

    expect(
      runner.parse(JSON.stringify({ result: "the answer", total_cost_usd: 0.0021 })),
    ).toStrictEqual({ text: "the answer", costUsd: 0.0021 });

    // Older builds, and a crash mid-stream, print the reply with no envelope.
    expect(runner.parse("just prose")).toStrictEqual({ text: "just prose", costUsd: 0 });
  });

  it("reads Codex's answer out of its event stream", () => {
    const runner = codexSourceAdapter.headless;
    if (runner === undefined) throw new Error("codex should offer a runner");

    // Its plain output interleaves a banner, the model's reasoning and a token
    // count with the reply; only the structured form can be read reliably.
    expect(runner.args("x")).toContain("--json");
  });

  it("takes opencode's reply as printed", () => {
    const runner = opencodeSourceAdapter.headless;
    if (runner === undefined) throw new Error("opencode should offer a runner");

    expect(runner.parse("a topic name")).toStrictEqual({ text: "a topic name", costUsd: 0 });
  });

  it("never invents a cost for a CLI that does not report one", () => {
    for (const adapter of ALL_SOURCE_ADAPTERS) {
      const runner = adapter.headless;
      if (runner === undefined) continue;
      if (adapter.id === "claude-code") continue;

      // Pricing a local or self-configured model would mean knowing a rate for
      // a model the user chose. Zero is the honest answer, not a guess.
      expect(runner.parse("anything").costUsd, adapter.id).toBe(0);
    }
  });
});
