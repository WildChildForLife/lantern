import { describe, expect, test } from "vitest";
import { AtisLatchEntrySchema } from "./AtisLatchEntrySchema.ts";

describe("AtisLatchEntrySchema", () => {
  test("accepts the entry Claude Code 2.1.258 writes", () => {
    const result = AtisLatchEntrySchema.safeParse({
      type: "atis-latch",
      atis: "",
      sessionId: "b3f136a7-5d62-494d-b630-d103919f82e2",
    });
    expect(result.success).toBe(true);
    const data = result.success ? result.data : undefined;
    expect(data?.type).toBe("atis-latch");
    expect(data?.atis).toBe("");
  });

  test("accepts a non-empty latch", () => {
    const result = AtisLatchEntrySchema.safeParse({
      type: "atis-latch",
      atis: "some-latched-state",
      sessionId: "b3f136a7-5d62-494d-b630-d103919f82e2",
    });
    expect(result.success).toBe(true);
    const data = result.success ? result.data : undefined;
    expect(data?.atis).toBe("some-latched-state");
  });

  // The two ways the next release can move without this becoming an x-error
  // again. Both are stated in the schema comment, and neither was pinned by the
  // cases above — adding `.strict()` or dropping `.optional()` used to leave the
  // suite green.
  test("accepts a latch the CLI stopped writing the field for", () => {
    const result = AtisLatchEntrySchema.safeParse({
      type: "atis-latch",
      sessionId: "b3f136a7-5d62-494d-b630-d103919f82e2",
    });
    expect(result.success).toBe(true);
    const data = result.success ? result.data : undefined;
    expect(data?.atis).toBeUndefined();
  });

  test("drops a field the CLI adds later instead of failing on it", () => {
    const result = AtisLatchEntrySchema.safeParse({
      type: "atis-latch",
      atis: "",
      sessionId: "b3f136a7-5d62-494d-b630-d103919f82e2",
      latchedAt: "2026-09-05T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
    expect(result.success && "latchedAt" in result.data).toBe(false);
  });

  test("rejects missing sessionId", () => {
    const result = AtisLatchEntrySchema.safeParse({ type: "atis-latch", atis: "" });
    expect(result.success).toBe(false);
  });

  test("rejects wrong type literal", () => {
    const result = AtisLatchEntrySchema.safeParse({
      type: "not-atis-latch",
      atis: "",
      sessionId: "abc-123",
    });
    expect(result.success).toBe(false);
  });
});
