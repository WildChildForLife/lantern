import { NodeContext } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { describe, expect } from "vitest";
import { makeDrizzleTestServiceLayer } from "../../../../testing/layers/testDrizzleServiceLayer.ts";
import { testPlatformLayer } from "../../../../testing/layers/testPlatformLayer.ts";
import { type DrizzleDb, DrizzleService } from "../../../lib/db/DrizzleService.ts";
import { projects, sessionTopics, sessions } from "../../../lib/db/schema.ts";
import { claudeCodeSourceAdapter } from "../../source/adapters/claude-code/ClaudeCodeSourceAdapter.ts";
import type { SourceAdapter } from "../../source/models/SourceAdapter.ts";
import { SourceRegistry } from "../../source/services/SourceRegistry.ts";
import { CLASSIFIER_MARKER } from "../functions/buildClassificationPrompt.ts";
import { TopicClassifierService } from "./TopicClassifierService.ts";

/**
 * The real adapter with its `headless` runner taken away. Every classification
 * attempt therefore fails before a process is spawned, which is what these tests
 * want: they pin which conversations a scope resolves to, and what a pass does
 * to the stored topics, without spending a CLI call to find out.
 */
const noHeadlessAdapter: SourceAdapter = { ...claudeCodeSourceAdapter, headless: undefined };

type SeedSession = {
  readonly id: string;
  readonly customTitle?: string | null;
  readonly firstUserMessageJson?: string | null;
  readonly topic?: string;
  readonly lastModifiedAt?: string;
};

const seedWith =
  (seedSessions: readonly SeedSession[]) =>
  (db: DrizzleDb): void => {
    db.insert(projects)
      .values({ id: "project", name: "shop", path: "/home/me/shop", dirMtimeMs: 0, syncedAt: 0 })
      .run();

    for (const session of seedSessions) {
      db.insert(sessions)
        .values({
          id: session.id,
          projectId: "project",
          filePath: `/home/me/.claude/projects/shop/${session.id}.jsonl`,
          customTitle: session.customTitle ?? null,
          firstUserMessageJson: session.firstUserMessageJson ?? null,
          fileMtimeMs: 0,
          lastModifiedAt: session.lastModifiedAt ?? "2026-07-01T10:00:00.000Z",
          syncedAt: 0,
        })
        .run();

      if (session.topic !== undefined) {
        db.insert(sessionTopics)
          .values({
            sessionId: session.id,
            label: session.topic,
            icon: "package",
            sourceText: session.customTitle ?? "",
            classifiedAt: 0,
          })
          .run();
      }
    }
  };

/**
 * The platform services are merged rather than only provided: asking a CLI
 * needs them in context at call time, so `classify` carries that requirement
 * even when the adapter cannot be asked anything.
 */
const testLayer = (seedSessions: readonly SeedSession[]) =>
  TopicClassifierService.Live.pipe(
    Layer.provide(SourceRegistry.withAdapters([noHeadlessAdapter])),
    Layer.provideMerge(makeDrizzleTestServiceLayer(seedWith(seedSessions))),
    Layer.provideMerge(Layer.mergeAll(testPlatformLayer(), NodeContext.layer)),
  );

const textMessage = (content: string) => JSON.stringify({ kind: "text", content });

describe("TopicClassifierService", () => {
  describe("countUnclassified", () => {
    it.effect("counts only the conversations with no topic row", () =>
      Effect.gen(function* () {
        const classifier = yield* TopicClassifierService;

        expect(yield* classifier.countUnclassified()).toBe(2);
      }).pipe(
        Effect.provide(
          testLayer([
            { id: "filed", customTitle: "Fix the checkout total", topic: "Shop" },
            { id: "new-one", customTitle: "Rework the topic classifier" },
            { id: "new-two", customTitle: "Update the README" },
          ]),
        ),
      ),
    );

    it.effect("does not re-queue a conversation whose title changed after filing", () =>
      Effect.gen(function* () {
        const classifier = yield* TopicClassifierService;

        // The stored sourceText is the old title; the session now has a new one.
        // That used to put it back in the pending set and re-bill it.
        expect(yield* classifier.countUnclassified()).toBe(0);
      }).pipe(
        Effect.provide(
          testLayer([{ id: "renamed", customTitle: "A much better title", topic: "Shop" }]),
        ),
      ),
    );

    it.effect("ignores the classifier's own runs and conversations with no text", () =>
      Effect.gen(function* () {
        const classifier = yield* TopicClassifierService;

        expect(yield* classifier.countUnclassified()).toBe(1);
      }).pipe(
        Effect.provide(
          testLayer([
            { id: "real", customTitle: "Rework the topic classifier" },
            {
              id: "classifier-run",
              firstUserMessageJson: textMessage(`${CLASSIFIER_MARKER}\nYou are organising...`),
            },
            { id: "textless" },
          ]),
        ),
      ),
    );
  });

  describe("classify", () => {
    it.effect("throws every stored topic away for the all scope", () =>
      Effect.gen(function* () {
        const classifier = yield* TopicClassifierService;
        const { db } = yield* DrizzleService;

        const result = yield* classifier.classify({ scope: { kind: "all" } });

        expect(db.select().from(sessionTopics).all()).toEqual([]);
        // Every conversation became a candidate once the topics were dropped.
        expect(result.requested).toBe(2);
        expect(result.classified).toBe(0);
        expect(result.failed).toBe(true);
      }).pipe(
        Effect.provide(
          testLayer([
            { id: "filed", customTitle: "Fix the checkout total", topic: "Shop" },
            { id: "new-one", customTitle: "Rework the topic classifier" },
          ]),
        ),
      ),
    );

    it.effect("takes an already-filed conversation when it was selected by hand", () =>
      Effect.gen(function* () {
        const classifier = yield* TopicClassifierService;

        const result = yield* classifier.classify({
          scope: { kind: "selection", sessionIds: ["filed"] },
        });

        expect(result.requested).toBe(1);
        expect(result.queued).toBe(1);
        expect(result.failed).toBe(true);
        // A selection pass says nothing about how many are unclassified.
        expect(result.remaining).toBe(1);
      }).pipe(
        Effect.provide(
          testLayer([
            { id: "filed", customTitle: "Fix the checkout total", topic: "Shop" },
            { id: "new-one", customTitle: "Rework the topic classifier" },
          ]),
        ),
      ),
    );

    it.effect("resolves a selection of ids it does not know to nothing", () =>
      Effect.gen(function* () {
        const classifier = yield* TopicClassifierService;

        const result = yield* classifier.classify({
          scope: { kind: "selection", sessionIds: ["does-not-exist"] },
        });

        expect(result).toEqual({
          classified: 0,
          remaining: 1,
          batches: 0,
          costUsd: 0,
          requested: 0,
          queued: 0,
          failed: false,
        });
      }).pipe(Effect.provide(testLayer([{ id: "new-one", customTitle: "Rework the classifier" }]))),
    );

    it.effect("leaves the filed conversations alone in the unclassified scope", () =>
      Effect.gen(function* () {
        const classifier = yield* TopicClassifierService;

        const result = yield* classifier.classify({ scope: { kind: "unclassified" } });

        expect(result.requested).toBe(1);
        expect(result.queued).toBe(1);
      }).pipe(
        Effect.provide(
          testLayer([
            { id: "filed", customTitle: "Fix the checkout total", topic: "Shop" },
            { id: "new-one", customTitle: "Rework the topic classifier" },
          ]),
        ),
      ),
    );
  });
});
