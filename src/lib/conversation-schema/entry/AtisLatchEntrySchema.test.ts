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
