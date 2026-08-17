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
 * The real adapter with its `headless` runner taken away, so a pass cannot ask
 * anything and nothing is spawned. Used to pin what happens when the chosen CLI
 * offers no headless mode.
 */
const noHeadlessAdapter: SourceAdapter = { ...claudeCodeSourceAdapter, headless: undefined };

/**
 * A runner that really does spawn something — `echo`, printing the answer the
 * test wants — so the whole path is exercised: resolving the executable,
 * `Command.string`, parsing, and storing. Cheap, offline, deterministic.
 *
 * The adapter keeps Claude Code's id because that is the source the default user
 * config points at, which is what decides who gets asked.
 */
const echoingAdapter = (answer: (candidateCount: number) => string): SourceAdapter => ({
  ...claudeCodeSourceAdapter,
  headless: {
    executable: () => Effect.succeed("/bin/echo"),
    args: (prompt) => {
      // The prompt numbers its candidates "1. ", "2. ", ... — count them so the
      // answer lines up with the batch actually being asked about.
      const count = prompt.split("\n").filter((line) => /^\d+\. /.test(line)).length;
      return [answer(count)];
    },
    parse: (stdout) => ({ text: stdout, costUsd: 0.001 }),
  },
});

/** A well-formed answer filing every candidate under one topic. */
const filesEverything = (count: number) =>
  JSON.stringify(
    Array.from({ length: count }, (_, index) => ({
      n: index + 1,
      topic: "Shop",
      icon: "package",
    })),
  );

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
const testLayer = (seedSessions: readonly SeedSession[], adapter: SourceAdapter) =>
  TopicClassifierService.Live.pipe(
    Layer.provide(SourceRegistry.withAdapters([adapter])),
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
          testLayer(
            [
              { id: "filed", customTitle: "Fix the checkout total", topic: "Shop" },
              { id: "new-one", customTitle: "Rework the topic classifier" },
              { id: "new-two", customTitle: "Update the README" },
            ],
            noHeadlessAdapter,
          ),
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
          testLayer(
            [{ id: "renamed", customTitle: "A much better title", topic: "Shop" }],
            noHeadlessAdapter,
          ),
        ),
      ),
    );

    it.effect("ignores the classifier's own runs and conversations with no text", () =>
      Effect.gen(function* () {
        const classifier = yield* TopicClassifierService;

        expect(yield* classifier.countUnclassified()).toBe(1);
      }).pipe(
        Effect.provide(
          testLayer(
            [
              { id: "real", customTitle: "Rework the topic classifier" },
              {
                id: "classifier-run",
                firstUserMessageJson: textMessage(`${CLASSIFIER_MARKER}\nYou are organising...`),
              },
              { id: "textless" },
            ],
            noHeadlessAdapter,
          ),
        ),
      ),
    );

    it.effect("does not count a row the SQL admits but the text rule rejects", () =>
      Effect.gen(function* () {
        const classifier = yield* TopicClassifierService;

        // `custom_title = ''` is NOT NULL, so the SQL narrowing lets it through;
        // the pure predicate is what drops it. The two are allowed to disagree
        // in exactly this direction and no other.
        expect(yield* classifier.countUnclassified()).toBe(0);
      }).pipe(Effect.provide(testLayer([{ id: "blank", customTitle: "   " }], noHeadlessAdapter))),
    );
  });

  describe("classify", () => {
    it.effect("files the unclassified conversations and leaves the rest alone", () =>
      Effect.gen(function* () {
        const classifier = yield* TopicClassifierService;
        const { db } = yield* DrizzleService;

        const result = yield* classifier.classify({ scope: { kind: "unclassified" } });

        expect(result).toEqual({
          classified: 1,
          remaining: 0,
          batches: 1,
          costUsd: 0.001,
          requested: 1,
          queued: 1,
          failed: false,
          failureReason: null,
        });
        // The already-filed conversation kept the label it had.
        expect(
          db
            .select()
            .from(sessionTopics)
            .all()
            .find((row) => row.sessionId === "filed")?.label,
        ).toBe("Orders");
      }).pipe(
        Effect.provide(
          testLayer(
            [
              { id: "filed", customTitle: "Fix the checkout total", topic: "Orders" },
              { id: "new-one", customTitle: "Rework the topic classifier" },
            ],
            echoingAdapter(filesEverything),
          ),
        ),
      ),
    );

    it.effect("caps a pass and reports what it did not queue", () =>
      Effect.gen(function* () {
        const classifier = yield* TopicClassifierService;

        const result = yield* classifier.classify({
          scope: { kind: "unclassified" },
          maxCandidates: 2,
        });

        expect(result.requested).toBe(3);
        expect(result.queued).toBe(2);
        expect(result.classified).toBe(2);
        // The one left over still has no topic, so a later pass will find it.
        expect(result.remaining).toBe(1);
      }).pipe(
        Effect.provide(
          testLayer(
            [
              { id: "a", customTitle: "One", lastModifiedAt: "2026-07-03T10:00:00.000Z" },
              { id: "b", customTitle: "Two", lastModifiedAt: "2026-07-02T10:00:00.000Z" },
              { id: "c", customTitle: "Three", lastModifiedAt: "2026-07-01T10:00:00.000Z" },
            ],
            echoingAdapter(filesEverything),
          ),
        ),
      ),
    );

    it.effect("takes the newest conversations when it has to choose", () =>
      Effect.gen(function* () {
        const classifier = yield* TopicClassifierService;
        const { db } = yield* DrizzleService;

        yield* classifier.classify({ scope: { kind: "unclassified" }, maxCandidates: 1 });

        expect(
          db
            .select()
            .from(sessionTopics)
            .all()
            .map((row) => row.sessionId),
        ).toEqual(["newest"]);
      }).pipe(
        Effect.provide(
          testLayer(
            [
              { id: "oldest", customTitle: "Old", lastModifiedAt: "2026-01-01T10:00:00.000Z" },
              { id: "newest", customTitle: "New", lastModifiedAt: "2026-07-01T10:00:00.000Z" },
            ],
            echoingAdapter(filesEverything),
          ),
        ),
      ),
    );

    it.effect("refiles everything for the all scope", () =>
      Effect.gen(function* () {
        const classifier = yield* TopicClassifierService;
        const { db } = yield* DrizzleService;

        const result = yield* classifier.classify({ scope: { kind: "all" } });

        expect(result.requested).toBe(2);
        expect(result.classified).toBe(2);
        expect(result.failed).toBe(false);
        // The old label is gone, replaced by what this pass decided.
        expect(
          db
            .select()
            .from(sessionTopics)
            .all()
            .map((row) => row.label),
        ).toEqual(["Shop", "Shop"]);
      }).pipe(
        Effect.provide(
          testLayer(
            [
              { id: "filed", customTitle: "Fix the checkout total", topic: "Orders" },
              { id: "new-one", customTitle: "Rework the topic classifier" },
            ],
            echoingAdapter(filesEverything),
          ),
        ),
      ),
    );

    it.effect("does not throw the topics away when the CLI cannot be asked", () =>
      Effect.gen(function* () {
        const classifier = yield* TopicClassifierService;
        const { db } = yield* DrizzleService;

        const result = yield* classifier.classify({ scope: { kind: "all" } });

        // "Redo all" with no usable CLI used to wipe every topic and file none.
        expect(db.select().from(sessionTopics).all()).toHaveLength(1);
        expect(result.classified).toBe(0);
        expect(result.failed).toBe(true);
      }).pipe(
        Effect.provide(
          testLayer(
            [
              { id: "filed", customTitle: "Fix the checkout total", topic: "Orders" },
              { id: "new-one", customTitle: "Rework the topic classifier" },
            ],
            noHeadlessAdapter,
          ),
        ),
      ),
    );

    it.effect("puts the topics back when a forced pass files nothing", () =>
      Effect.gen(function* () {
        const classifier = yield* TopicClassifierService;
        const { db } = yield* DrizzleService;

        const result = yield* classifier.classify({ scope: { kind: "all" } });

        expect(result.classified).toBe(0);
        expect(result.failed).toBe(true);
        // The CLI answered, so the wipe went ahead - and then said nothing
        // usable, so what was there before is restored rather than lost.
        expect(
          db
            .select()
            .from(sessionTopics)
            .all()
            .map((row) => row.label),
        ).toEqual(["Orders"]);
      }).pipe(
        Effect.provide(
          testLayer(
            [
              { id: "filed", customTitle: "Fix the checkout total", topic: "Orders" },
              { id: "new-one", customTitle: "Rework the topic classifier" },
            ],
            echoingAdapter(() => "sorry, I cannot help with that"),
          ),
        ),
      ),
    );

    it.effect("takes an already-filed conversation when it was selected by hand", () =>
      Effect.gen(function* () {
        const classifier = yield* TopicClassifierService;
        const { db } = yield* DrizzleService;

        const result = yield* classifier.classify({
          scope: { kind: "selection", sessionIds: ["filed"] },
        });

        expect(result.requested).toBe(1);
        expect(result.classified).toBe(1);
        // Refiled under what this pass decided, not left on its old label.
        expect(
          db
            .select()
            .from(sessionTopics)
            .all()
            .find((row) => row.sessionId === "filed")?.label,
        ).toBe("Shop");
        // A selection pass says nothing about how many are unclassified.
        expect(result.remaining).toBe(1);
      }).pipe(
        Effect.provide(
          testLayer(
            [
              { id: "filed", customTitle: "Fix the checkout total", topic: "Orders" },
              { id: "new-one", customTitle: "Rework the topic classifier" },
            ],
            echoingAdapter(filesEverything),
          ),
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
          failureReason: null,
        });
      }).pipe(
        Effect.provide(
          testLayer(
            [{ id: "new-one", customTitle: "Rework the classifier" }],
            echoingAdapter(filesEverything),
          ),
        ),
      ),
    );
  });
});
