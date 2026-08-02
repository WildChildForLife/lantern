import { expect, test } from "vitest";
import {
  buildClassificationPrompt,
  CLASSIFIER_MARKER,
  parseClassificationResponse,
} from "./buildClassificationPrompt.ts";

const candidate = (sessionId: string, text: string, projectPath: string | null = null) => ({
  sessionId,
  text,
  projectPath,
});

test("opens with the marker so the classifier's own sessions can be spotted later", () => {
  const prompt = buildClassificationPrompt([candidate("1", "Fix the login form")], []);

  expect(prompt.startsWith(CLASSIFIER_MARKER)).toBe(true);
});

test("numbers the conversations and includes the folder as a hint", () => {
  const prompt = buildClassificationPrompt(
    [candidate("1", "Fix the login form", "/home/me/shop"), candidate("2", "Rotate deploy keys")],
    [],
  );

  expect(prompt).toContain("1. Fix the login form  [folder: /home/me/shop]");
  expect(prompt).toContain("2. Rotate deploy keys");
});

test("offers the existing topics back for reuse", () => {
  const prompt = buildClassificationPrompt(
    [candidate("1", "Anything")],
    ["Home Network", "Orders"],
  );

  expect(prompt).toContain("Home Network, Orders");
});

test("says so when there are no topics yet", () => {
  const prompt = buildClassificationPrompt([candidate("1", "Anything")], []);

  expect(prompt).toContain("(none yet - you are naming the first topics)");
});

test("collapses whitespace and caps how much of a conversation is sent", () => {
  const prompt = buildClassificationPrompt(
    [candidate("1", `Fix   the\n\nlogin ${"x".repeat(400)}`)],
    [],
  );
  const line = prompt.split("\n").find((entry) => entry.startsWith("1. "));

  expect(line).not.toContain("\t");
  expect(line?.length).toBeLessThanOrEqual(164);
  expect(prompt).toContain("1. Fix the login");
});

test("reads a plain JSON answer", () => {
  const parsed = parseClassificationResponse('[{"n":1,"topic":"Orders","icon":"puzzle"}]');

  expect(parsed).toEqual([{ n: 1, topic: "Orders", icon: "puzzle" }]);
});

test("reads an answer wrapped in prose or code fences", () => {
  const parsed = parseClassificationResponse(
    'Sure! Here you go:\n```json\n[{"n":1,"topic":"Orders","icon":"puzzle"}]\n```\nHope that helps.',
  );

  expect(parsed).toEqual([{ n: 1, topic: "Orders", icon: "puzzle" }]);
});

test("rejects an answer with no array in it", () => {
  expect(parseClassificationResponse("I could not do that.")).toBeNull();
});

test("rejects malformed JSON rather than throwing", () => {
  expect(parseClassificationResponse('[{"n":1,"topic":]')).toBeNull();
});

test("rejects entries that do not match the expected shape", () => {
  expect(
    parseClassificationResponse('[{"n":"first","topic":"Orders","icon":"puzzle"}]'),
  ).toBeNull();
  expect(parseClassificationResponse('[{"topic":"Orders"}]')).toBeNull();
});
