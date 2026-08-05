import { describe, expect, it } from "vitest";
import { z } from "zod";
import { linkParents, syntheticEntryUuid } from "./entryIdentity.ts";

describe("syntheticEntryUuid", () => {
  it("produces something the entry schema accepts as a uuid", () => {
    expect(z.uuid().safeParse(syntheticEntryUuid("codex", "session-a", 0)).success).toBe(true);
  });

  /** Search results and message links are keyed by position; a re-sync must not move them. */
  it("gives the same id for the same position every time", () => {
    expect(syntheticEntryUuid("codex", "session-a", 7)).toBe(
      syntheticEntryUuid("codex", "session-a", 7),
    );
  });

  it("separates positions, sessions and sources", () => {
    const ids = new Set([
      syntheticEntryUuid("codex", "session-a", 0),
      syntheticEntryUuid("codex", "session-a", 1),
      syntheticEntryUuid("codex", "session-b", 0),
      syntheticEntryUuid("opencode", "session-a", 0),
    ]);

    expect(ids.size).toBe(4);
  });

  it("stays collision-free across a long session", () => {
    const ids = new Set(
      Array.from({ length: 5000 }, (_, index) => syntheticEntryUuid("codex", "s", index)),
    );

    expect(ids.size).toBe(5000);
  });
});

describe("linkParents", () => {
  it("chains each entry to the one before it", () => {
    const linked = linkParents([{ uuid: "a" }, { uuid: "b" }, { uuid: "c" }]);

    expect(linked.map((entry) => entry.parentUuid)).toStrictEqual([null, "a", "b"]);
  });

  it("handles an empty transcript", () => {
    expect(linkParents([])).toStrictEqual([]);
  });
});
