import { expect, test } from "vitest";
import { topicColorClass, topicTextColorClass } from "./topicColor";

test("gives a topic the same colour every time", () => {
  expect(topicColorClass("home-network")).toBe(topicColorClass("home-network"));
});

test("gives different topics different colours", () => {
  const colours = new Set(
    ["orders", "home-network", "portfolio", "mobile", "docs", "infra"].map(topicColorClass),
  );

  expect(colours.size).toBeGreaterThan(1);
});

test("keeps the catch-all topic neutral", () => {
  expect(topicColorClass("other")).toBe("bg-muted text-muted-foreground");
});

test("always pairs a background with a foreground", () => {
  for (const topic of ["orders", "home-network", "portfolio", "etl", "docs"]) {
    const classes = topicColorClass(topic).split(" ");

    expect(classes.some((className) => className.startsWith("bg-"))).toBe(true);
    expect(classes.some((className) => className.startsWith("text-"))).toBe(true);
  }
});

test("drops the background when only the icon colour is wanted", () => {
  const classes = topicTextColorClass("orders");

  expect(classes).not.toContain("bg-");
  expect(classes).toContain("text-");
});

test("handles a topic id that is empty or unusual", () => {
  expect(topicColorClass("")).toMatch(/^bg-/);
  expect(topicColorClass("🙂 unicode topic")).toMatch(/^bg-/);
});
