import { expect, test } from "vitest";
import { CLASSIFIER_MARKER, LEGACY_CLASSIFIER_MARKERS } from "./buildClassificationPrompt.ts";
import {
  type ClassificationCandidateRow,
  classificationCandidateText,
  isClassifierOwnRow,
  selectPassCandidates,
  toClassificationCandidate,
} from "./classificationCandidates.ts";

const row = (overrides: Partial<ClassificationCandidateRow> = {}): ClassificationCandidateRow => ({
  sessionId: "session",
  projectPath: "/home/me/shop",
  customTitle: "Fix the checkout total",
  firstUserMessageJson: null,
  ...overrides,
});

const textMessage = (content: string) => JSON.stringify({ kind: "text", content });

test("prefers the title over the first message", () => {
  expect(
    classificationCandidateText(
      row({ customTitle: "Fix the checkout total", firstUserMessageJson: textMessage("VAT") }),
    ),
  ).toBe("Fix the checkout total");
});

test("falls back to the first message when the title is blank", () => {
  expect(
    classificationCandidateText(
      row({ customTitle: "   ", firstUserMessageJson: textMessage("VAT is doubled") }),
    ),
  ).toBe("VAT is doubled");
  expect(
    classificationCandidateText(
      row({ customTitle: null, firstUserMessageJson: textMessage("VAT is doubled") }),
    ),
  ).toBe("VAT is doubled");
});

test("cuts a long first message down to what the prompt shows", () => {
  const long = "a".repeat(400);
  expect(
    classificationCandidateText(row({ customTitle: null, firstUserMessageJson: textMessage(long) }))
      .length,
  ).toBe(160);
});

test("reads a first message whatever shape it was logged in", () => {
  expect(
    classificationCandidateText(
      row({
        customTitle: null,
        firstUserMessageJson: JSON.stringify({
          kind: "command",
          commandName: "/init",
          commandArgs: "--force",
        }),
      }),
    ),
  ).toBe("/init --force");
  expect(
    classificationCandidateText(
      row({
        customTitle: null,
        firstUserMessageJson: JSON.stringify({ kind: "local-command", stdout: "done" }),
      }),
    ),
  ).toBe("done");
});

test("treats malformed message json as no text rather than throwing", () => {
  expect(() =>
    classificationCandidateText(row({ customTitle: null, firstUserMessageJson: "{not json" })),
  ).not.toThrow();
  expect(
    classificationCandidateText(row({ customTitle: null, firstUserMessageJson: "{not json" })),
  ).toBe("");
  // Valid JSON that is not a message shape takes the same path.
  expect(
    classificationCandidateText(
      row({ customTitle: null, firstUserMessageJson: '{"kind":"nope"}' }),
    ),
  ).toBe("");
  expect(
    toClassificationCandidate(row({ customTitle: null, firstUserMessageJson: "{not json" })),
  ).toBeNull();
});

test("drops a row with no text at all", () => {
  expect(toClassificationCandidate(row({ customTitle: null }))).toBeNull();
  expect(toClassificationCandidate(row({ customTitle: "  " }))).toBeNull();
});

test("recognises the classifier's own runs, current and legacy", () => {
  expect(
    isClassifierOwnRow(
      row({
        customTitle: null,
        firstUserMessageJson: textMessage(`${CLASSIFIER_MARKER}\nYou are organising...`),
      }),
    ),
  ).toBe(true);

  for (const marker of LEGACY_CLASSIFIER_MARKERS) {
    expect(
      isClassifierOwnRow(
        row({ customTitle: null, firstUserMessageJson: textMessage(`${marker} rest of it`) }),
      ),
    ).toBe(true);
  }
});

test("a conversation that only mentions the marker mid-message is not internal", () => {
  // Guards the raw-substring fast path: it may only rule rows out, never in.
  const mentions = row({
    customTitle: null,
    firstUserMessageJson: textMessage(`why does ${CLASSIFIER_MARKER} show up in my logs?`),
  });

  expect(isClassifierOwnRow(mentions)).toBe(false);
  expect(toClassificationCandidate(mentions)).not.toBeNull();
});

test("a row with no first message is never internal", () => {
  expect(isClassifierOwnRow(row({ firstUserMessageJson: null }))).toBe(false);
});

test("builds a candidate from the columns the prompt needs", () => {
  expect(
    toClassificationCandidate(row({ sessionId: "abc", projectPath: "/home/me/shop" })),
  ).toEqual({ sessionId: "abc", text: "Fix the checkout total", projectPath: "/home/me/shop" });
});

test("caps a pass while reporting everything the scope resolved to", () => {
  const rows = Array.from({ length: 5 }, (_, index) =>
    row({ sessionId: `s${index}`, customTitle: `Title ${index}` }),
  );

  const { queued, requested } = selectPassCandidates(rows, 2);

  expect(requested).toBe(5);
  expect(queued.map((candidate) => candidate.sessionId)).toEqual(["s0", "s1"]);
});

test("counts only classifiable rows as requested", () => {
  const rows = [
    row({ sessionId: "keep" }),
    row({ sessionId: "textless", customTitle: null }),
    row({
      sessionId: "internal",
      customTitle: null,
      firstUserMessageJson: textMessage(`${CLASSIFIER_MARKER} go`),
    }),
  ];

  expect(selectPassCandidates(rows, 10)).toEqual({
    queued: [{ sessionId: "keep", text: "Fix the checkout total", projectPath: "/home/me/shop" }],
    requested: 1,
  });
});

test("leaves the rows it was given alone", () => {
  const rows = [row({ sessionId: "a" }), row({ sessionId: "b" })];
  const snapshot = structuredClone(rows);

  selectPassCandidates(rows, 1);

  expect(rows).toEqual(snapshot);
});
