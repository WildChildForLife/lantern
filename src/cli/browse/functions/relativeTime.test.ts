import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "./relativeTime.ts";

const now = new Date("2026-08-07T12:00:00.000Z");

describe("formatRelativeTime", () => {
  it("reads as now for the last minute", () => {
    expect(formatRelativeTime("2026-08-07T11:59:30.000Z", now)).toBe("now");
  });

  it.each([
    ["2026-08-07T11:55:00.000Z", "5m"],
    ["2026-08-07T09:00:00.000Z", "3h"],
    ["2026-08-05T12:00:00.000Z", "2d"],
    ["2026-07-10T12:00:00.000Z", "4w"],
    ["2025-08-07T12:00:00.000Z", "1y"],
  ])("renders %s as %s", (timestamp, expected) => {
    expect(formatRelativeTime(timestamp, now)).toBe(expected);
  });

  /**
   * Clock skew between machines whose logs are read together can put a
   * conversation slightly in the future; it must not render as "-3m".
   */
  it("clamps a timestamp in the future", () => {
    expect(formatRelativeTime("2026-08-07T12:05:00.000Z", now)).toBe("now");
  });

  it("says nothing rather than NaN for an unparseable timestamp", () => {
    expect(formatRelativeTime("not a date", now)).toBe("—");
  });
});
