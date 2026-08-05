import { expect, test } from "vitest";
import {
  classifySelectionBodySchema,
  classifyQuerySchema,
  scopeFromQuery,
} from "./classifyScope.ts";

test("defaults to the cheap scope when nothing is asked for", () => {
  expect(scopeFromQuery({})).toEqual({ kind: "unclassified" });
});

test("reads an explicit scope", () => {
  expect(scopeFromQuery({ scope: "unclassified" })).toEqual({ kind: "unclassified" });
  expect(scopeFromQuery({ scope: "all" })).toEqual({ kind: "all" });
});

test("keeps honouring force=true from older clients", () => {
  expect(scopeFromQuery({ force: "true" })).toEqual({ kind: "all" });
  expect(scopeFromQuery({ force: "false" })).toEqual({ kind: "unclassified" });
});

test("an explicit scope beats force", () => {
  expect(scopeFromQuery({ scope: "unclassified", force: "true" })).toEqual({
    kind: "unclassified",
  });
  expect(scopeFromQuery({ scope: "all", force: "false" })).toEqual({ kind: "all" });
});

test("rejects a scope it does not know", () => {
  expect(classifyQuerySchema.safeParse({ scope: "everything" }).success).toBe(false);
});

test("rejects a selection with nothing in it", () => {
  // An empty selection would otherwise cost a pass over the default scope.
  expect(classifySelectionBodySchema.safeParse({ sessionIds: [] }).success).toBe(false);
  expect(classifySelectionBodySchema.safeParse({ sessionIds: [""] }).success).toBe(false);
});

test("accepts a selection", () => {
  expect(classifySelectionBodySchema.parse({ sessionIds: ["a", "b"] })).toEqual({
    sessionIds: ["a", "b"],
  });
});
