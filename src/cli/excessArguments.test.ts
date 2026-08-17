import { describe, expect, it } from "vitest";
import { describeExcessArguments } from "./excessArguments.ts";

describe("describeExcessArguments", () => {
  it("has nothing to say when the command was typed on its own", () => {
    expect(describeExcessArguments([], "lantern browse")).toBe(null);
  });

  it("names the command and the word it cannot take", () => {
    const message = describeExcessArguments(["orders-api"], "lantern browse");

    expect(message).toContain("`lantern browse` takes no arguments");
    expect(message).toContain("'orders-api'");
  });

  it("names every stray word, not only the first", () => {
    const message = describeExcessArguments(["orders-api", "webhooks"], "lantern browse");

    expect(message).toContain("'orders-api', 'webhooks'");
  });

  /**
   * The reader's next move is finding out what the command does take, and each
   * one has its own options.
   */
  it("points at the command's own help rather than the program's", () => {
    const message = describeExcessArguments(["extra"], "lantern init");

    expect(message).toContain("`lantern init --help`");
  });
});
